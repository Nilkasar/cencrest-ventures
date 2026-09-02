import type { BadgeProps } from "@bebest/ui";
import { INTENT_TYPE_LABEL } from "@/data/query-universe/constants";
import type { QueryIntentType } from "@/data/query-universe/types";
import type { GapSeverity, GapType, MovementDirection } from "./types";

/** Display-only label/variant maps for Epic 8's enum-shaped values — same
 *  role `data/ai-visibility/labels.ts` plays for Epic 7. */

export const GAP_TYPE_LABEL: Record<GapType, string> = {
  intent_gap: "Intent gap",
  content_gap: "Content gap",
  entity_gap: "Entity gap",
  source_gap: "Source gap",
};

/** One clause each, matching `docs/11-geo/GEO_ENGINE.md`'s four
 *  definitions verbatim (see the backend completion doc's "Gap-type
 *  definitions" section) — shown under each finding's type badge so a
 *  reader never has to remember what the label means. */
export const GAP_TYPE_DESCRIPTION: Record<GapType, string> = {
  intent_gap: "Competitors appear in AI answers for this query; you don't.",
  content_gap: "AI cites a competitor's content for this topic; you have none it cites.",
  entity_gap: "You have zero presence across this entire query category.",
  source_gap: "A domain AI trusts for this query set contains no content of yours.",
};

export const GAP_TYPE_BADGE_VARIANT: Record<GapType, NonNullable<BadgeProps["variant"]>> = {
  intent_gap: "danger",
  content_gap: "warning",
  entity_gap: "danger",
  source_gap: "warning",
};

export const GAP_SEVERITY_LABEL: Record<GapSeverity, string> = {
  high: "High",
  medium: "Medium",
};

export const GAP_SEVERITY_BADGE_VARIANT: Record<GapSeverity, NonNullable<BadgeProps["variant"]>> = {
  high: "danger",
  medium: "warning",
};

export const MOVEMENT_DIRECTION_LABEL: Record<MovementDirection, string> = {
  increase: "Increasing",
  decrease: "Decreasing",
  flat: "Flat",
};

export const MOVEMENT_DIRECTION_BADGE_VARIANT: Record<MovementDirection, NonNullable<BadgeProps["variant"]>> = {
  increase: "danger", // a competitor moving UP is bad news for you — read as a warning signal, not a success one
  decrease: "success",
  flat: "neutral",
};

const KNOWN_INTENT_TYPES = new Set<string>(["informational", "commercial", "comparison", "transactional"]);

/** `perIntentTypeGap[].intentType` is `queries.intent_type` OR the literal
 *  string `'uncategorized'` (the backend's own fallback for a query with no
 *  intent type) — this wraps `INTENT_TYPE_LABEL` (Epic 5's four-value enum
 *  map) with that fifth case rather than widening that map's type for one
 *  Epic 8 caller. */
export function intentTypeLabel(value: string): string {
  if (KNOWN_INTENT_TYPES.has(value)) return INTENT_TYPE_LABEL[value as QueryIntentType];
  if (value === "uncategorized") return "Uncategorized";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
