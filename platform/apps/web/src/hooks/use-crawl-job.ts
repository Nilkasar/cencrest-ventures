"use client";

import { useCallback, useEffect, useState } from "react";
import { getCrawlProgress, getLatestCrawlJob, startCrawl } from "@/data/website/client";
import type { CrawlProgress } from "@/data/website/types";

const POLL_INTERVAL_MS = 1000;

export type CrawlJobState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "empty" }
  | { status: "ready"; progress: CrawlProgress };

interface UseCrawlJobResult {
  state: CrawlJobState;
  /** True while the "start a crawl" request is in flight — distinct from
   *  `state.status === "loading"` (the initial "does a job already exist"
   *  check), so the empty state's button can show its own loading spinner
   *  without the whole screen flashing back to a skeleton. */
  starting: boolean;
  start: () => Promise<void>;
  reload: () => void;
}

/** Loads the latest crawl job for a brand, then polls
 *  `getCrawlProgress` once a second for as long as it's non-terminal —
 *  the client-side mirror of polling `GET /crawl-jobs/:id` while a
 *  background job runs. Stops polling the moment a job completes, fails,
 *  or is cancelled. */
export function useCrawlJob(brandId: string): UseCrawlJobResult {
  const [state, setState] = useState<CrawlJobState>({ status: "loading" });
  const [starting, setStarting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Same legitimate exception `use-async-data.ts` documents: a brand or
    // manual reload genuinely needs a fresh loading state before the new
    // fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    async function load() {
      try {
        const job = await getLatestCrawlJob(brandId);
        if (cancelled) return;
        if (!job) {
          setState({ status: "empty" });
          return;
        }
        const progress = await getCrawlProgress(job.id, brandId);
        if (cancelled) return;
        setState({ status: "ready", progress });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [brandId, reloadToken]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { job } = state.progress;
    if (job.status !== "pending" && job.status !== "running") return;

    let cancelled = false;
    const interval = setInterval(() => {
      getCrawlProgress(job.id, brandId)
        .then((progress) => {
          if (!cancelled) setState({ status: "ready", progress });
        })
        .catch((error: unknown) => {
          if (!cancelled) setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-armed whenever the job identity or its terminal-ness changes —
    // `state` itself is intentionally excluded so a tick doesn't tear down
    // and recreate the interval on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status === "ready" ? state.progress.job.id : null, state.status === "ready" ? state.progress.job.status : null, brandId]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const job = await startCrawl(brandId);
      const progress = await getCrawlProgress(job.id, brandId);
      setState({ status: "ready", progress });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      setStarting(false);
    }
  }, [brandId]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { state, starting, start, reload };
}
