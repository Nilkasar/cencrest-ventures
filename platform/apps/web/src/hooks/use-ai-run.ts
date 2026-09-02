"use client";

import { useCallback, useEffect, useState } from "react";
import { getAiRun, getLatestAiRun, startAiRun } from "@/data/ai-visibility/client";
import type { AiRun } from "@/data/ai-visibility/types";

const POLL_INTERVAL_MS = 2000;

export type AiRunState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "empty" }
  | { status: "ready"; run: AiRun };

interface UseAiRunResult {
  state: AiRunState;
  /** True while the "start a run" request is in flight — distinct from
   *  `state.status === "loading"` (the initial "does a run already exist"
   *  check), same split `useCrawlJob` makes, so the empty state's button
   *  can show its own spinner without the whole screen flashing back to a
   *  skeleton. */
  starting: boolean;
  /** The error `start()` most recently threw, or `null`. Kept separate
   *  from `state` (unlike the crawl hook) because a failed start attempt
   *  (e.g. hitting the entitlement cap) should surface inline on the empty
   *  state, not replace the whole screen with a generic error panel —
   *  these errors are typed (`AiQueryLimitError`/`AiRunPreconditionError`)
   *  specifically so the caller can render a precise message. */
  startError: unknown;
  start: () => Promise<void>;
  reload: () => void;
}

/**
 * Loads the org's latest AI Visibility run, then polls `GET /ai-runs/:id`
 * (`getAiRun`) once every two seconds for as long as it's non-terminal —
 * the real progress screen's poll loop the epic's UI surface asks for,
 * adapted from `use-crawl-job.ts`'s identical shape (Epic 3's crawler).
 * Stops polling the moment a run completes or fails.
 *
 * A full run is documented as 30–60 minutes (`docs/13-agents/AGENT_ARCHITECTURE.md`);
 * a 2s interval (vs. the crawler's 1s) is deliberately a little coarser —
 * this is a background job with dozens to thousands of steps, not a
 * page-by-page crawl a user is likely to watch tick in real time.
 */
export function useAiRun(): UseAiRunResult {
  const [state, setState] = useState<AiRunState>({ status: "loading" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Same legitimate exception `use-async-data.ts` documents: a manual
    // reload genuinely needs a fresh loading state before the new fetch
    // resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    getLatestAiRun()
      .then((run) => {
        if (cancelled) return;
        setState(run ? { status: "ready", run } : { status: "empty" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { run } = state;
    if (run.status !== "queued" && run.status !== "running") return;

    let cancelled = false;
    const interval = setInterval(() => {
      getAiRun(run.id)
        .then((next) => {
          if (!cancelled) setState({ status: "ready", run: next });
        })
        .catch((error: unknown) => {
          if (!cancelled) setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-armed whenever the run identity or its terminal-ness changes —
    // `state` itself is intentionally excluded so a tick doesn't tear down
    // and recreate the interval on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status === "ready" ? state.run.id : null, state.status === "ready" ? state.run.status : null]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const run = await startAiRun();
      setState({ status: "ready", run });
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }, []);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { state, starting, startError, start, reload };
}
