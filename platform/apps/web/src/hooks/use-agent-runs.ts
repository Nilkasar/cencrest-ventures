"use client";

import { useEffect, useState } from "react";
import { useAsyncData } from "@/lib/use-async-data";
import { listAgentRuns } from "@/data/agents/client";
import type { AgentRun } from "@/data/agents/types";

const HISTORY_POLL_INTERVAL_MS = 4000;

/**
 * The "agent-runs history list per brand" this epic's UI surface asks for.
 * Built on `useAsyncData` (same base every list screen in this app uses)
 * plus a light poll — every 4s, coarser than a single run's own 2s detail
 * poll, since this list only needs to notice a queued/running row flip to
 * completed/failed, not track step-by-step progress (that's what clicking
 * into `/agents/:id` and `useAgentRun` is for). Polling stops the moment no
 * row in the list is still in flight.
 */
export function useAgentRuns() {
  const { reload, ...state } = useAsyncData(() => listAgentRuns(), []);
  const [tick, setTick] = useState(0);

  const hasActiveRun = state.status === "success" && state.data.some((r: AgentRun) => r.status === "queued" || r.status === "running");

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = setInterval(() => setTick((t) => t + 1), HISTORY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActiveRun]);

  useEffect(() => {
    if (tick > 0) reload();
    // Only fires when `tick` itself advances (the interval above) — `reload`
    // is stable (`useCallback` in `useAsyncData`), so this never double-fires
    // on its own identity changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { reload, ...state };
}
