"use client";

import { useCallback, useEffect, useState } from "react";
import { getAiRun } from "@/data/ai-visibility/client";
import type { AiRun } from "@/data/ai-visibility/types";
import { getLatestCompetitorAiRun, startCompetitorAiRun } from "@/data/competitive-intelligence/client";

const POLL_INTERVAL_MS = 2000;

export type CompetitorAiRunState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "empty" }
  | { status: "ready"; run: AiRun };

interface UseCompetitorAiRunResult {
  state: CompetitorAiRunState;
  starting: boolean;
  startError: unknown;
  start: () => Promise<void>;
  reload: () => void;
}

/**
 * The per-competitor twin of `use-ai-run.ts` — one instance per
 * `CompetitorCard` (each competitor row owns its own trigger + poll
 * lifecycle independently, since a portfolio of tracked competitors runs
 * on no shared schedule). Identical polling contract: loads the
 * competitor's latest run, then polls `GET /ai-runs/:id` (the same
 * organization-scoped route Epic 7 uses — it doesn't care whether
 * `competitor_id` is set) once every two seconds for as long as it's
 * non-terminal.
 */
export function useCompetitorAiRun(competitorId: string): UseCompetitorAiRunResult {
  const [state, setState] = useState<CompetitorAiRunState>({ status: "loading" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    getLatestCompetitorAiRun(competitorId)
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
  }, [competitorId, reloadToken]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status === "ready" ? state.run.id : null, state.status === "ready" ? state.run.status : null]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const run = await startCompetitorAiRun(competitorId);
      setState({ status: "ready", run });
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }, [competitorId]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { state, starting, startError, start, reload };
}
