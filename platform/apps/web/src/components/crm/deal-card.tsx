"use client";

import Link from "next/link";
import { Building2, Calendar, GripVertical, MoreHorizontal, User } from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  getInitials,
} from "@bebest/ui";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type Deal, type DealStage } from "@/data/crm/types";
import { formatCurrency, formatDate } from "@/lib/format";

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
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", deal.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(deal.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      aria-busy={isPending || undefined}
      // The card being dragged fades and lifts so it reads as "in hand"
      // rather than still sitting in its old column; a card whose move is
      // still in flight stays legible but muted until the server confirms.
      className={`group rounded-lg border bg-surface-raised p-3 shadow-xs transition-[opacity,box-shadow,border-color] duration-150 motion-reduce:transition-none cursor-grab active:cursor-grabbing ${
        isDragging
          ? "opacity-40 border-accent shadow-md"
          : "border-border hover:border-border-strong"
      } ${isPending && !isDragging ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/crm/deals/${deal.id}`} className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground leading-snug hover:underline">{deal.title}</p>
        </Link>
        <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Move ${deal.title} to a different stage`}
              className="rounded-md p-1 text-subtle-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DEAL_STAGE_SEQUENCE.filter((s) => s !== deal.stage).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => onMoveStage(deal.id, s)}>
                  {DEAL_STAGE_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <GripVertical size={14} className="text-subtle-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
        </div>
      </div>

      {linkedName && (
        <Link
          href={linkedHref ?? "#"}
          className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground w-fit"
        >
          <Building2 size={12} className="shrink-0" />
          <span className="truncate max-w-[160px]">{linkedName}</span>
        </Link>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-mono text-[13px] font-semibold text-foreground">{formatCurrency(deal.valueCents, deal.currency)}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{deal.probability}%</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {deal.expectedCloseDate ? (
          <span className="flex items-center gap-1 text-[11px] text-subtle-foreground">
            <Calendar size={11} /> {formatDate(deal.expectedCloseDate)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-subtle-foreground">
            <User size={11} /> No close date
          </span>
        )}
        <Avatar fallback={getInitials(deal.owner.name)} size="sm" className="size-6 text-[10px]" />
      </div>
    </div>
  );
}
