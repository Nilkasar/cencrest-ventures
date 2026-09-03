import type { BadgeProps } from "@bebest/ui";
import { OPPORTUNITY_STATUS_BADGE_VARIANT, OPPORTUNITY_STATUS_LABEL } from "@/data/opportunities/labels";
import type { RecommendationActionType, RecommendationLevel, RecommendationStatus } from "./types";

/** Display-only label/variant maps for Epic 10 (Recommendation Engine) —
 *  same role `data/opportunities/labels.ts` plays for Epic 9. */

export const ACTION_TYPE_LABEL: Record<RecommendationActionType, string> = {
  create_page: "Create a page",
  update_page: "Update a page",
  fix_technical: "Fix technical issue",
  build_citations: "Build citations",
};

export const ACTION_TYPE_BADGE_VARIANT: Record<RecommendationActionType, NonNullable<BadgeProps["variant"]>> = {
  create_page: "accent",
  update_page: "outline",
  fix_technical: "warning",
  build_citations: "outline",
};

/** `status` reuses `opportunity_status` server-side (same four values), so
 *  its label/badge maps are imported from Epic 9's module rather than
 *  redeclared — one source of truth for what "New"/"In progress" etc. mean
 *  and look like across the product. */
export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = OPPORTUNITY_STATUS_LABEL;
export const RECOMMENDATION_STATUS_BADGE_VARIANT: Record<RecommendationStatus, NonNullable<BadgeProps["variant"]>> =
  OPPORTUNITY_STATUS_BADGE_VARIANT;

export const LEVEL_LABEL: Record<RecommendationLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Effort: lower is better (cheaper to execute) — same inverted-threshold
 *  reasoning `data/opportunities/labels.ts`'s `effortTone` documents. */
export const EFFORT_BADGE_VARIANT: Record<RecommendationLevel, NonNullable<BadgeProps["variant"]>> = {
  low: "success",
  medium: "warning",
  high: "danger",
};

/** Impact: higher is better — same `scoreTone` convention as Epic 9. */
export const IMPACT_BADGE_VARIANT: Record<RecommendationLevel, NonNullable<BadgeProps["variant"]>> = {
  low: "neutral",
  medium: "warning",
  high: "success",
};

/** `implementationNotes`'s exact wire format from
 *  `lib/recommendations/generator.ts`'s `implementationNotesForRecommendation`:
 *  `"SEO requirements: ...\n\nGEO requirements: ..."`, the GEO half carrying
 *  a trailing evidence-grounding clause. Split here so the UI can render the
 *  dual SEO+GEO requirement as two visibly distinct blocks — never a bare
 *  paragraph — per this epic's "never presented as a bare instruction with
 *  no backing" UI requirement. Falls back to one undivided block if the
 *  server ever changes the format (defensive, not expected in practice). */
export function splitImplementationNotes(notes: string): { seo: string; geo: string } | null {
  const marker = "\n\nGEO requirements: ";
  const idx = notes.indexOf(marker);
  if (idx === -1) return null;
  const seo = notes.slice("SEO requirements: ".length, idx);
  const geo = notes.slice(idx + marker.length);
  return { seo, geo };
}
