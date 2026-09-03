import type { BadgeProps } from "@bebest/ui";
import type { AttributionConfidence } from "./types";

/** Display-only label/variant maps for Epic 14 (Measurement & Learning
 *  Loop) — same role `data/actions/labels.ts`/`data/seo/labels.ts` play
 *  for their epics. The label always says "estimate," never a bare
 *  confidence word alone — this epic's non-negotiable #4, that attribution
 *  is never presented as more certain than the backend's own language. */
export const ATTRIBUTION_CONFIDENCE_LABEL: Record<AttributionConfidence, string> = {
  high: "High-confidence estimate",
  medium: "Medium-confidence estimate",
  low: "Low-confidence estimate",
};

/** Same `high -> success / medium -> warning / low -> outline` mapping
 *  `KEYWORD_CONFIDENCE_BADGE_VARIANT` (`data/seo/labels.ts`) already
 *  establishes for the identical three-value vocabulary — one consistent
 *  "how much should you trust this" treatment across the app. */
export const ATTRIBUTION_CONFIDENCE_BADGE_VARIANT: Record<AttributionConfidence, NonNullable<BadgeProps["variant"]>> = {
  high: "success",
  medium: "warning",
  low: "outline",
};
