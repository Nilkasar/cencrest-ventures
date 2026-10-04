"use client";

import type { AsyncState } from "@/lib/use-async-data";
import type { MovementResult } from "@/data/competitive-intelligence/types";
import { formatDelta } from "@/lib/format";
import { MovementBadge } from "./status-badges";

/**
 * A competitor's run-over-run movement (`GET .../movement`, comparing its
 * two most recent completed runs), rendered as a compact value for the
 * detail header. There is no proactive alert feed yet — that ships with
 * the scheduled Competitor Agent — so this is fetched when the page opens.
 */
export function MovementValue({ state }: { state: AsyncState<MovementResult> }) {
  if (state.status === "loading") return <span className="text-muted-foreground">Checking…</span>;
  if (state.status === "error") return <span className="text-muted-foreground">Unavailable</span>;
  const r = state.data;
  if (r.direction === null || r.delta === null) {
    return <span className="text-muted-foreground">{r.latestScore === null ? "No completed run" : "Needs a second run"}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={r.sentence ?? undefined}>
      <MovementBadge direction={r.direction} />
      <span className="font-mono text-[12.5px] tabular-nums">{formatDelta(r.delta, 1, " pts")}</span>
    </span>
  );
}
