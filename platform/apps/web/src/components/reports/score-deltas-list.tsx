import { Gauge } from "lucide-react";
import { Badge, EmptyState, cn } from "@bebest/ui";
import { ATTRIBUTION_CONFIDENCE_BADGE_VARIANT, ATTRIBUTION_CONFIDENCE_LABEL } from "@/data/measurement/labels";
import type { Measurement } from "@/data/measurement/types";
import { formatDate, formatDelta } from "@/lib/format";

/**
 * A weekly/monthly/custom report's `scoreDeltas` — Epic 14's real
 * `measurements` rows inside the period (each an approved action's
 * before/after). Each delta is drawn on a shared diverging scale (zero in
 * the middle) so their sizes compare at a glance; attribution confidence
 * and its plain-language note always ride along, so a delta is never
 * shown as more certain than the backend says it is.
 */
export function ScoreDeltasList({ measurements }: { measurements: Measurement[] }) {
  if (measurements.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          compact
          icon={<Gauge size={18} />}
          title="No measured actions in this period"
          description="Score deltas appear once an approved action has been re-measured against its before score — about four weeks after it's published."
        />
      </div>
    );
  }

  const maxAbs = Math.max(1, ...measurements.map((m) => Math.abs(m.scoreDelta ?? 0)));

  return (
    <ul className="divide-y divide-border">
      {measurements.map((measurement) => {
        const d = measurement.scoreDelta;
        const tone = d === null || d === 0 ? "text-muted-foreground" : d > 0 ? "text-success" : "text-danger";
        const fill = d === null || d === 0 ? "bg-muted-foreground" : d > 0 ? "bg-success" : "bg-danger";
        const half = d === null ? 0 : (Math.abs(d) / maxAbs) * 50;
        return (
          <li key={measurement.id} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_180px_64px] sm:items-center sm:gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatDate(measurement.measuredAt)}</span>
                <Badge variant={ATTRIBUTION_CONFIDENCE_BADGE_VARIANT[measurement.attributionConfidence]} size="sm">
                  {ATTRIBUTION_CONFIDENCE_LABEL[measurement.attributionConfidence]}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{measurement.attributionNotes}</p>
            </div>
            <div className="relative hidden h-4 sm:block" aria-hidden="true">
              <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface" />
              <span className="absolute left-1/2 top-0 h-full w-px bg-border-strong" />
              {d !== null && d !== 0 && (
                <span
                  className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-80", fill)}
                  style={d > 0 ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }}
                />
              )}
            </div>
            <p className={cn("text-right font-mono text-[15px] font-semibold tabular-nums", tone)}>
              {d === null ? "—" : formatDelta(d, 1)}
              <span className="sr-only"> points</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
