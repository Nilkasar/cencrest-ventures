"use client";

import { motion } from "framer-motion";
import { Badge, type BadgeProps, cn, easings } from "@bebest/ui";
import type { OpportunityStatus, SeoKeywordConfidence, SeoKeywordIntent } from "@/data/seo/types";
import { KEYWORD_CONFIDENCE_LABEL, KEYWORD_INTENT_LABEL, OPPORTUNITY_STATUS_LABEL, type ScoreTone } from "@/data/seo/labels";

/**
 * SEO Intelligence's status → tone map (patterns README §6), plus the two
 * small score encodings every section of the page shares.
 */
const OPPORTUNITY_STATUS_TONE: Record<OpportunityStatus, NonNullable<BadgeProps["variant"]>> = {
  new: "neutral",
  in_progress: "info",
  completed: "success",
  dismissed: "neutral",
};

/** `estimate` is deliberately distinct from `low` — an estimate must never
 *  read as a firm number (Epic 4, end-to-end flow step 2). */
const CONFIDENCE_TONE: Record<SeoKeywordConfidence, NonNullable<BadgeProps["variant"]>> = {
  high: "success",
  medium: "warning",
  low: "neutral",
  estimate: "outline",
};

export function SeoOpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  return (
    <Badge variant={OPPORTUNITY_STATUS_TONE[status]} size="sm" dot>
      {OPPORTUNITY_STATUS_LABEL[status]}
    </Badge>
  );
}

export function KeywordConfidenceBadge({ confidence }: { confidence: SeoKeywordConfidence }) {
  return (
    <Badge variant={CONFIDENCE_TONE[confidence]} size="sm" dot={confidence !== "estimate"}>
      {KEYWORD_CONFIDENCE_LABEL[confidence]}
    </Badge>
  );
}

/** Intent is a category, not a status — outline, no dot. */
export function KeywordIntentBadge({ intent }: { intent: SeoKeywordIntent }) {
  return (
    <Badge variant="outline" size="sm">
      {KEYWORD_INTENT_LABEL[intent]}
    </Badge>
  );
}

export const TONE_TEXT: Record<ScoreTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export const TONE_FILL: Record<ScoreTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export const TONE_LABEL: Record<ScoreTone, string> = {
  success: "Good",
  warning: "Needs work",
  danger: "Poor",
};

/**
 * A 0–100 value as a short horizontal meter with its number. Used for the
 * factors behind a score, so "show the work" reads at a glance. The bar is
 * decorative (`aria-hidden`); the number carries the value.
 */
export function Meter({
  value,
  max = 100,
  fillClassName = "bg-foreground/60",
  className,
  delay = 0,
}: {
  value: number;
  max?: number;
  fillClassName?: string;
  className?: string;
  delay?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className={cn("relative block h-1.5 w-full overflow-hidden rounded-full bg-surface", className)} aria-hidden="true">
      <motion.span
        className={cn("absolute inset-y-0 left-0 rounded-full", fillClassName)}
        style={{ width: `${pct}%`, originX: 0 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, delay, ease: easings.emphasized }}
      />
    </span>
  );
}
