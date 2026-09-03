import type { BadgeProps } from "@bebest/ui";
import type { OpportunityPriority, OpportunityStatus, OpportunityType } from "./types";

/** Display-only label/variant maps for Epic 9 (Opportunity Engine) — same
 *  role `data/seo/labels.ts` plays for Epic 4. */

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  unified: "Unified (SEO + GEO)",
  seo: "SEO only",
  geo: "GEO only",
  content: "Content gap",
  technical: "Technical gap",
};

/** `unified` gets the ONLY accent (verdant) badge in this screen on purpose
 *  — it's the literal "high search demand + low AI visibility" intersection
 *  `PRODUCT_VISION.md`'s Pillar 3 is built around, and per `DESIGN.md` the
 *  accent color is reserved for the single most important signal on a
 *  screen. `seo`/`geo`-only rows are still real, valid opportunities — just
 *  not the ones with two lines of evidence pointing at them. */
export const OPPORTUNITY_TYPE_BADGE_VARIANT: Record<OpportunityType, NonNullable<BadgeProps["variant"]>> = {
  unified: "accent",
  seo: "outline",
  geo: "outline",
  content: "neutral",
  technical: "neutral",
};

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  new: "New",
  in_progress: "In progress",
  completed: "Completed",
  dismissed: "Dismissed",
};

export const OPPORTUNITY_STATUS_BADGE_VARIANT: Record<OpportunityStatus, NonNullable<BadgeProps["variant"]>> = {
  new: "accent",
  in_progress: "warning",
  completed: "success",
  dismissed: "neutral",
};

/** `priorityFromScore` in the backend's `merge-scoring.ts` buckets at 60/30
 *  (`opportunityScore >= 60` -> 1, `>= 30` -> 2, else 3) — 1 is the MOST
 *  urgent, not a rank position, so it gets the attention-grabbing (but not
 *  alarming) `warning` treatment rather than `danger`, which is reserved for
 *  actual errors elsewhere in this system. */
export const PRIORITY_LABEL: Record<OpportunityPriority, string> = {
  1: "High priority",
  2: "Medium priority",
  3: "Low priority",
};

export const PRIORITY_BADGE_VARIANT: Record<OpportunityPriority, NonNullable<BadgeProps["variant"]>> = {
  1: "warning",
  2: "outline",
  3: "neutral",
};

/** `source_table` values `routes/opportunities.ts` actually writes today —
 *  see its header comment's "Evidence — the exact sentence format" section.
 *  Falls back to a humanized version of the raw value for anything else,
 *  same defensive shape `data/seo/labels.ts`'s `opportunityTypeLabel` uses
 *  for the same kind of "open string, closed UI vocabulary" gap. */
const SOURCE_TABLE_LABEL: Record<string, string> = {
  seo_keywords: "Search demand",
  ai_runs: "AI visibility",
};

export function sourceTableLabel(sourceTable: string): string {
  return SOURCE_TABLE_LABEL[sourceTable] ?? sourceTable.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ScoreTone = "success" | "warning" | "danger";

/** Impact/opportunity score coloring — higher is better, same >=80/>=50
 *  threshold convention `data/seo/labels.ts`'s `scoreTone` uses. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

/** Effort is the one score where LOWER is better — inverted thresholds so a
 *  60-effort tile doesn't read "warning" on both the impact side and the
 *  effort side of the same card for opposite reasons. */
export function effortTone(score: number): ScoreTone {
  if (score <= 35) return "success";
  if (score <= 65) return "warning";
  return "danger";
}

export type ScoreBand = "high" | "medium" | "low";

/** Client-side effort/impact bucketing for the two filters the API itself
 *  has no query params for (`GET /brands/me/opportunities` only filters
 *  `status`/`type`/`priority` server-side — see `routes/opportunities.ts`).
 *  Applied to the already-fetched, real page of opportunities, never to
 *  fixture data; documented as a known limitation (narrows only the current
 *  page, not the server-side total) in the epic's frontend completion doc. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}
