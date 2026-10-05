"use client";

import { motion } from "framer-motion";
import { Badge, type BadgeProps, cn, easings } from "@bebest/ui";
import type { Opportunity, OpportunityPriority, OpportunityStatus, OpportunityType } from "@/data/opportunities/types";
import { OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_TYPE_LABEL, PRIORITY_LABEL } from "@/data/opportunities/labels";

/**
 * Opportunities' status → tone map (patterns README §6), in one file.
 * Status: not started is inert (neutral), in progress is in motion (info),
 * completed is a good outcome (success). Type is a category (outline).
 * Priority 1 is "at risk of being missed" (warning). The only accent
 * marker is "Quick win" — the README's "recommended" slot.
 */
const STATUS_TONE: Record<OpportunityStatus, NonNullable<BadgeProps["variant"]>> = {
  new: "neutral",
  in_progress: "info",
  completed: "success",
  dismissed: "neutral",
};

const PRIORITY_TONE: Record<OpportunityPriority, NonNullable<BadgeProps["variant"]>> = {
  1: "warning",
  2: "outline",
  3: "neutral",
};

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  return (
    <Badge variant={STATUS_TONE[status]} size="sm" dot>
      {OPPORTUNITY_STATUS_LABEL[status]}
    </Badge>
  );
}

export function OpportunityTypeBadge({ type }: { type: OpportunityType }) {
  return (
    <Badge variant="outline" size="sm">
      {OPPORTUNITY_TYPE_LABEL[type]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: OpportunityPriority }) {
  return (
    <Badge variant={PRIORITY_TONE[priority]} size="sm">
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

/** Same definition the Overview's impact-vs-effort map uses for its
 *  "Quick wins" quadrant, so the two screens agree. */
export function isQuickWin(o: Pick<Opportunity, "impactScore" | "effortScore">): boolean {
  return o.impactScore >= 50 && o.effortScore < 50;
}

export function QuickWinBadge() {
  return (
    <Badge variant="accent" size="sm" title="High impact (50+) for low effort (under 50)">
      Quick win
    </Badge>
  );
}

/** 0–100 as a short bar; decorative — the adjacent number carries the value. */
export function ScoreMeter({ value, fillClassName = "bg-foreground/60", delay = 0 }: { value: number | null; fillClassName?: string; delay?: number }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
      {value !== null && (
        <motion.span
          className={cn("absolute inset-y-0 left-0 rounded-full", fillClassName)}
          style={{ width: `${pct}%`, originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay, ease: easings.emphasized }}
        />
      )}
    </span>
  );
}
