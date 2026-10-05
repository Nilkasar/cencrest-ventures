import { CalendarClock } from "lucide-react";
import { cn } from "@bebest/ui";
import type { Deal, DealStage } from "@/data/crm/types";
import { formatDate } from "@/lib/format";

/** Stages a deal can still move out of. Won and Lost are terminal. */
export function isOpenStage(stage: DealStage): boolean {
  return stage !== "won" && stage !== "lost";
}

/** An open deal whose expected close date is before today. Only ever
 *  evaluated after a client-side fetch, so there's no SSR clock to drift
 *  from. */
export function isOverdue(deal: Pick<Deal, "stage" | "expectedCloseDate">, now: Date = new Date()): boolean {
  if (!deal.expectedCloseDate || !isOpenStage(deal.stage)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(deal.expectedCloseDate).getTime() < today;
}

export interface PipelineTotals {
  openCount: number;
  openValue: number;
  /** Open value × each deal's own probability. */
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  /** Won ÷ (won + lost), 0–100, or null while nothing has closed. */
  winRate: number | null;
}

/** Roll-ups over the deals actually returned by the API — callers say so
 *  when that's fewer than the API's `total`. */
export function pipelineTotals(deals: Deal[]): PipelineTotals {
  let openCount = 0;
  let openValue = 0;
  let weightedValue = 0;
  let wonCount = 0;
  let wonValue = 0;
  let lostCount = 0;
  for (const deal of deals) {
    if (deal.stage === "won") {
      wonCount += 1;
      wonValue += deal.valueCents;
    } else if (deal.stage === "lost") {
      lostCount += 1;
    } else {
      openCount += 1;
      openValue += deal.valueCents;
      weightedValue += (deal.valueCents * deal.probability) / 100;
    }
  }
  const closed = wonCount + lostCount;
  return {
    openCount,
    openValue,
    weightedValue,
    wonCount,
    wonValue,
    lostCount,
    winRate: closed > 0 ? (wonCount / closed) * 100 : null,
  };
}

/** Expected close date, flagged in words (not just color) when an open deal
 *  has slipped past it. */
export function DealCloseDate({
  deal,
  className,
  emptyLabel = "No close date",
}: {
  deal: Pick<Deal, "stage" | "expectedCloseDate">;
  className?: string;
  emptyLabel?: string;
}) {
  if (!deal.expectedCloseDate) {
    return <span className={cn("text-subtle-foreground", className)}>{emptyLabel}</span>;
  }
  const overdue = isOverdue(deal);
  return (
    <span className={cn("inline-flex items-center gap-1", overdue ? "text-warning" : "text-muted-foreground", className)}>
      {overdue && <CalendarClock size={12} className="shrink-0" aria-hidden="true" />}
      {formatDate(deal.expectedCloseDate)}
      {overdue && <span className="font-medium">· Overdue</span>}
    </span>
  );
}
