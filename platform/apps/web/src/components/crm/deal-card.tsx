"use client";

import Link from "next/link";
import { Building2, User } from "lucide-react";
import { Avatar, cn, getInitials } from "@bebest/ui";
import { DEAL_STAGE_LABEL, type Deal, type DealStage } from "@/data/crm/types";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { DealMoveMenu } from "@/components/crm/deal-move-menu";
import { DealCloseDate, isOpenStage } from "@/components/crm/deal-utils";
import { typography } from "@/components/patterns/typography";
import { formatCurrency } from "@/lib/format";

/**
 * One deal on the pipeline board. Drag it between columns, or use the
 * "…" menu — the keyboard and screen-reader path to the same moves.
 */
export function DealCard({
  deal,
  linkedName,
  linkedHref,
  isDragging = false,
  isPending = false,
  onDragStart,
  onDragEnd,
  onMoveStage,
}: {
  deal: Deal;
  linkedName: string | null;
  linkedHref: string | null;
  /** This card is the one currently being dragged. */
  isDragging?: boolean;
  /** Moved locally; the server hasn't confirmed the new stage yet. */
  isPending?: boolean;
  onDragStart: (dealId: string) => void;
  onDragEnd?: () => void;
  onMoveStage: (dealId: string, stage: DealStage) => void;
}) {
  const crm = useCrmBasePath();
  const LinkIcon = deal.linkedTo?.kind === "lead" ? User : Building2;

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", deal.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(deal.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      aria-busy={isPending || undefined}
      aria-label={`${deal.title}, ${formatCurrency(deal.valueCents, deal.currency)}, ${DEAL_STAGE_LABEL[deal.stage]}`}
      // The card being dragged fades so it reads as "in hand" rather than
      // still sitting in its old column; a card whose move is still in
      // flight stays legible but muted until the server confirms.
      className={cn(
        "group relative cursor-grab rounded-xl border bg-surface-raised p-3.5 shadow-xs active:cursor-grabbing",
        "transition-[opacity,box-shadow,border-color] duration-150 motion-reduce:transition-none",
        isDragging ? "border-accent opacity-40 shadow-md" : "border-border hover:border-border-strong hover:shadow-sm",
        isPending && !isDragging && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`${crm}/deals/${deal.id}`}
          draggable={false}
          className="min-w-0 flex-1 rounded-sm text-[13px] font-medium leading-snug text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {deal.title}
        </Link>
        <DealMoveMenu deal={deal} onMoveStage={onMoveStage} className="-mr-1.5 -mt-1" />
      </div>

      {linkedName && (
        <Link
          href={linkedHref ?? `${crm}/deals/${deal.id}`}
          draggable={false}
          className="mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LinkIcon size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{linkedName}</span>
        </Link>
      )}

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className={cn(typography.numeric, "text-[13px] font-semibold")}>{formatCurrency(deal.valueCents, deal.currency)}</span>
        {isOpenStage(deal.stage) && (
          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground" title="Win probability">
            {deal.probability}%<span className="sr-only"> probability</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <DealCloseDate deal={deal} className="min-w-0 truncate text-[11.5px]" />
        <span title={`Owner: ${deal.owner.name}`} className="shrink-0">
          <Avatar fallback={getInitials(deal.owner.name)} size="sm" className="size-6 text-[10px]" />
          <span className="sr-only">Owner: {deal.owner.name}</span>
        </span>
      </div>
    </article>
  );
}
