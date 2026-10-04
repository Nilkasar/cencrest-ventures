import { AlertTriangle } from "lucide-react";
import { cn } from "@bebest/ui";
import type { ScoreDeltaResult, ScoreSnapshot } from "@/data/reporting/types";
import { formatDate, formatDelta } from "@/lib/format";
import { ScoreShift } from "./score-shift";

const BASIS_LABEL: Record<ScoreDeltaResult["basis"], string> = {
  geo: "AI Visibility Score",
  seo: "SEO Health Score",
  none: "No comparable score",
};

function basisValue(snapshot: ScoreSnapshot, basis: ScoreDeltaResult["basis"]): number | null {
  if (basis === "geo") return snapshot.geo?.aiVisibilityScore ?? null;
  if (basis === "seo") return snapshot.seo?.overallScore ?? null;
  return null;
}

/**
 * The headline of a `baseline_comparison` report — `after − before` on
 * whichever basis `computeScoreDelta` picked (GEO preferred). The "score
 * must land" moment: large, signed, colored by direction, always labeled
 * with its basis, and drawn as baseline → today on the full 0–100 scale so
 * the change has context rather than standing alone.
 */
export function ScoreDeltaSummary({
  scoreDelta,
  baseline,
  current,
}: {
  scoreDelta: ScoreDeltaResult;
  baseline: ScoreSnapshot;
  current: ScoreSnapshot;
}) {
  const d = scoreDelta.delta;
  const tone = d === null || d === 0 ? "text-muted-foreground" : d > 0 ? "text-success" : "text-danger";
  const before = basisValue(baseline, scoreDelta.basis);
  const after = basisValue(current, scoreDelta.basis);

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10">
      <div>
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Change since baseline</p>
        <p className={cn("mt-2 font-display text-[56px] font-semibold leading-none tracking-[-0.02em] tabular-nums", tone)}>
          {d !== null ? formatDelta(d, 1) : "—"}
          {d !== null && <span className="ml-1.5 font-sans text-[15px] font-normal tracking-normal text-muted-foreground">pts</span>}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">{BASIS_LABEL[scoreDelta.basis]}</p>
      </div>

      {before !== null && after !== null ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[12px] text-muted-foreground">Baseline · {formatDate(baseline.capturedAt)}</p>
              <p className="font-mono text-[20px] font-semibold tabular-nums text-muted-foreground">{before.toFixed(1)}</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">Now · {formatDate(current.capturedAt)}</p>
              <p className="font-mono text-[20px] font-semibold tabular-nums text-foreground">{after.toFixed(1)}</p>
            </div>
          </div>
          <ScoreShift before={before} after={after} beforeLabel="Baseline" afterLabel="Now" />
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Neither side has a score to compare yet — the delta appears once both do.</p>
      )}

      {scoreDelta.formulaVersionsMatch === false && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-foreground sm:col-span-2">
          <AlertTriangle size={13} className="shrink-0 text-warning" aria-hidden="true" />
          The scoring formula changed between baseline and now — treat this change as directional.
        </p>
      )}
    </div>
  );
}
