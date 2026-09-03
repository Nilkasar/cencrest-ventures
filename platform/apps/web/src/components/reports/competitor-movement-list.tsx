import { TrendingUp } from "lucide-react";
import { Badge, EmptyState } from "@bebest/ui";
import { MOVEMENT_DIRECTION_BADGE_VARIANT, MOVEMENT_DIRECTION_LABEL } from "@/data/competitive-intelligence/labels";
import type { CompetitorMovementEntry } from "@/data/reporting/types";

/**
 * `lib/reporting/sections.ts`'s `getCompetitorMovements` output, rendered
 * with the identical badge vocabulary `MovementPanel` (Epic 8's
 * competitors screen) already establishes — same direction, same color
 * meaning ("a competitor moving UP is bad news for you," per that file's
 * own comment), so a reader who has seen one screen recognizes the other
 * instantly.
 */
export function CompetitorMovementList({ movements }: { movements: CompetitorMovementEntry[] }) {
  const withData = movements.filter((m) => m.sentence !== null);

  if (withData.length === 0) {
    return (
      <EmptyState
        compact
        icon={<TrendingUp size={18} />}
        title="No competitor movement to report"
        description="Either there's no prior run to compare against yet, or nothing changed within this period."
      />
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
      {withData.map((movement) => (
        <div key={movement.competitorId} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground truncate">{movement.competitorName}</p>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{movement.sentence}</p>
          </div>
          {movement.direction && (
            <Badge variant={MOVEMENT_DIRECTION_BADGE_VARIANT[movement.direction]} size="sm" className="shrink-0">
              {MOVEMENT_DIRECTION_LABEL[movement.direction]}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
