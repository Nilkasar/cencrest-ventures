"use client";

import { useCallback, useEffect, useState } from "react";
import { getCrawlJob, getLatestCrawlJob, startCrawl } from "@/data/website/client";
import type { CrawlJob } from "@/data/website/types";

const POLL_INTERVAL_MS = 1000;

export type CrawlJobState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "empty" }
  | { status: "ready"; job: CrawlJob };

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

/** Loads the latest crawl job tracked for an organization, then polls
 *  `GET /crawl-jobs/:id` (`getCrawlJob`) once a second for as long as it's
 *  non-terminal — this is the real progress screen's poll loop the epic's
 *  UI surface asks for. Stops polling the moment a job completes, fails, or
 *  is cancelled.
 *
 *  Post-verification fix: this used to poll a `localStorage`-derived
 *  `CrawlProgress` (job + a synthesized six-step timeline) computed from
 *  elapsed wall-clock time against a fake fixed schedule. It now polls the
 *  real job row directly — no synthesized steps, because the real crawl
 *  pipeline has no phase signal beyond `status` plus the incremental
 *  `pagesCrawled`/`pagesFound`/`pagesFailed` counters this hook now
 *  surfaces as-is. See `components/website/crawl-progress-panel.tsx`. */
export function useCrawlJob(organizationId: string): UseCrawlJobResult {
  const [state, setState] = useState<CrawlJobState>({ status: "loading" });
  const [starting, setStarting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Same legitimate exception `use-async-data.ts` documents: an org or
    // manual reload genuinely needs a fresh loading state before the new
    // fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    async function load() {
      try {
        const job = await getLatestCrawlJob(organizationId);
        if (cancelled) return;
        setState(job ? { status: "ready", job } : { status: "empty" });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, reloadToken]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { job } = state;
    if (job.status !== "queued" && job.status !== "running") return;

    let cancelled = false;
    const interval = setInterval(() => {
      getCrawlJob(job.id)
        .then((next) => {
          if (!cancelled) setState({ status: "ready", job: next });
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
  }, [state.status === "ready" ? state.job.id : null, state.status === "ready" ? state.job.status : null]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const job = await startCrawl(organizationId);
      setState({ status: "ready", job });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      setStarting(false);
    }
  }, [organizationId]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { state, starting, start, reload };
}
