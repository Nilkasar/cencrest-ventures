import { TrendingUp } from "lucide-react";
import { Badge, EmptyState } from "@bebest/ui";
import { MOVEMENT_DIRECTION_BADGE_VARIANT, MOVEMENT_DIRECTION_LABEL } from "@/data/competitive-intelligence/labels";
import type { CompetitorMovementEntry } from "@/data/reporting/types";
import { formatDelta } from "@/lib/format";
import { ScoreShift } from "./score-shift";

/**
 * A report's competitor movement — `lib/reporting/sections.ts`'s
 * `getCompetitorMovements`, with the same badge vocabulary as the
 * Competitors screen (a competitor moving UP is bad news for you). Each
 * row draws the competitor's previous → latest AI visibility on one
 * 0–100 track, tinted from your point of view. Rendered as a flush,
 * divided list for a `Section flush`.
 */
export function CompetitorMovementList({ movements }: { movements: CompetitorMovementEntry[] }) {
  const withData = movements.filter((m) => m.sentence !== null);

  if (withData.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          compact
          icon={<TrendingUp size={18} />}
          title="No competitor movement to report"
          description="Either there's no earlier run to compare against yet, or nothing changed in this period."
        />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {withData.map((movement) => (
        <li key={movement.competitorId} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[13px] font-medium text-foreground">{movement.competitorName}</p>
              {movement.direction && (
                <Badge variant={MOVEMENT_DIRECTION_BADGE_VARIANT[movement.direction]} size="sm" dot>
                  {MOVEMENT_DIRECTION_LABEL[movement.direction]}
                </Badge>
              )}
              {movement.delta !== null && (
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatDelta(movement.delta, 1, " pts")}</span>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{movement.sentence}</p>
          </div>
          {movement.previousScore !== null && movement.latestScore !== null && (
            <ScoreShift before={movement.previousScore} after={movement.latestScore} beforeLabel="Previous" afterLabel="Latest" upIsGood={false} compact />
          )}
        </li>
      ))}
    </ul>
  );
}
