import { Gauge } from "lucide-react";
import { Badge, EmptyState } from "@bebest/ui";
import { ATTRIBUTION_CONFIDENCE_BADGE_VARIANT, ATTRIBUTION_CONFIDENCE_LABEL } from "@/data/measurement/labels";
import type { Measurement } from "@/data/measurement/types";
import { formatDate } from "@/lib/format";

/** Delta color: positive is a real improvement, negative a real regression
 *  — the same "measured, not written" trust the mono numeral itself signals
 *  (`packages/ui/DESIGN.md`), so the color follows the sign honestly rather
 *  than defaulting to a neutral tone. */
function deltaTone(delta: number | null): string {
  if (delta === null) return "text-muted-foreground";
  if (delta > 0) return "text-success";
  if (delta < 0) return "text-danger";
  return "text-muted-foreground";
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}`;
}

/**
 * A `weekly`/`monthly`/`custom` report's `scoreDeltas` section — Epic 14's
 * real `measurements` rows recorded inside the period (each one an
 * approved action's before/after comparison), never a re-derivation.
 * Attribution confidence is always shown paired with its plain-language
 * note, per Epic 14's non-negotiable that a delta is never presented as
 * more certain than the backend's own language says it is.
 */
export function ScoreDeltasList({ measurements }: { measurements: Measurement[] }) {
  if (measurements.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Gauge size={18} />}
        title="No measured actions in this period"
        description="Score deltas appear here once an approved action has been re-measured against its before score."
      />
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
      {measurements.map((measurement) => (
        <div key={measurement.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-mono text-[11px] text-subtle-foreground">{formatDate(measurement.measuredAt)}</p>
              <Badge variant={ATTRIBUTION_CONFIDENCE_BADGE_VARIANT[measurement.attributionConfidence]} size="sm">
                {ATTRIBUTION_CONFIDENCE_LABEL[measurement.attributionConfidence]}
              </Badge>
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">{measurement.attributionNotes}</p>
          </div>
          <p className={`font-mono text-[18px] font-semibold shrink-0 ${deltaTone(measurement.scoreDelta)}`}>
            {formatDelta(measurement.scoreDelta)}
          </p>
        </div>
      ))}
    </div>
  );
}
