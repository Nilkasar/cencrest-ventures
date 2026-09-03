"use client";

import { useCallback, useEffect, useState } from "react";
import { getAgentRun } from "@/data/agents/client";
import type { AgentRunDetail } from "@/data/agents/types";

const POLL_INTERVAL_MS = 2000;

export type AgentRunDetailState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; run: AgentRunDetail };

/**
 * Loads one agent run's full detail (`GET /agent-runs/:id`) then polls it
 * every two seconds for as long as it's non-terminal — the live-updating run
 * view this epic's UI surface asks for ("real evidence links"), adapted
 * from `use-ai-run.ts`'s identical shape (Epic 7), itself adapted from
 * `use-crawl-job.ts` (Epic 3). Stops polling the moment the run completes
 * or fails; every poll re-fetches the full event stream so a newly-appended
 * `agent_events` row (this IS the append-only transparency
 * AGENT_ARCHITECTURE.md calls a trust differentiator) shows up within one
 * tick.
 */
export function useAgentRun(runId: string) {
  const [state, setState] = useState<AgentRunDetailState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Same legitimate exception `use-async-data.ts` documents: a manual
    // reload genuinely needs a fresh loading state before the new fetch
    // resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    getAgentRun(runId)
      .then((run) => {
        if (!cancelled) setState({ status: "ready", run });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => {
      cancelled = true;
    };
  }, [runId, reloadToken]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const { run } = state;
    if (run.status !== "queued" && run.status !== "running") return;

    let cancelled = false;
    const interval = setInterval(() => {
      getAgentRun(runId)
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
    // Re-armed whenever the run's terminal-ness changes — `state` itself is
    // intentionally excluded so a tick doesn't tear down and recreate the
    // interval on every poll, same pattern `use-ai-run.ts` uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, state.status === "ready" ? state.run.status : null]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { state, reload };
}
