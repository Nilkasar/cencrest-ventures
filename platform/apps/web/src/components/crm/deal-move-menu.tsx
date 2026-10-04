"use client";

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@bebest/ui";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type Deal, type DealStage } from "@/data/crm/types";
import { isOpenStage } from "@/components/crm/deal-utils";

/**
 * The keyboard/screen-reader path for every stage move a drag can make,
 * plus one-step Won/Lost shortcuts. Shared by the board card and the list
 * row so a deal moves the same way wherever it's shown.
 */
export function DealMoveMenu({
  deal,
  onMoveStage,
  className,
}: {
  deal: Pick<Deal, "id" | "title" | "stage">;
  onMoveStage: (dealId: string, stage: DealStage) => void;
  className?: string;
}) {
  const open = isOpenStage(deal.stage);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Move ${deal.title} to another stage`}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-surface data-[state=open]:text-foreground",
          className,
        )}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {open && (
          <>
            <DropdownMenuItem onSelect={() => onMoveStage(deal.id, "won")}>Mark as won</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMoveStage(deal.id, "lost")}>Mark as lost…</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={deal.stage} onValueChange={(value) => onMoveStage(deal.id, value as DealStage)}>
          {DEAL_STAGE_SEQUENCE.map((s) => (
            <DropdownMenuRadioItem key={s} value={s} disabled={s === deal.stage}>
              {DEAL_STAGE_LABEL[s]}
              {s === "lost" && s !== deal.stage ? "…" : ""}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
