import type { BadgeProps } from "@bebest/ui";
import { ISSUE_TYPE_LABEL } from "@/data/website/labels";
import type { OpportunityStatus, SeoKeywordConfidence, SeoKeywordIntent, SeoProviderSource } from "./types";

/** Display-only label/variant maps for Epic 4 (SEO Intelligence) — same role
 *  `data/query-universe/constants.ts` and `data/website/labels.ts` play for
 *  their epics. */

export const KEYWORD_INTENT_LABEL: Record<SeoKeywordIntent, string> = {
  informational: "Informational",
  navigational: "Navigational",
  commercial: "Commercial",
  transactional: "Transactional",
};

export const KEYWORD_INTENT_BADGE_VARIANT: Record<SeoKeywordIntent, NonNullable<BadgeProps["variant"]>> = {
  informational: "neutral",
  navigational: "outline",
  commercial: "accent",
  transactional: "success",
};

export const KEYWORD_CONFIDENCE_LABEL: Record<SeoKeywordConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  estimate: "Estimate",
};

/** `estimate` gets its own neutral-but-distinct treatment on purpose — the
 *  epic spec's hard requirement (end-to-end flow step 2) is "never silently
 *  presenting an estimate as a firm number," so this is never allowed to
 *  read the same as `low`. */
export const KEYWORD_CONFIDENCE_BADGE_VARIANT: Record<SeoKeywordConfidence, NonNullable<BadgeProps["variant"]>> = {
  high: "success",
  medium: "warning",
  low: "outline",
  estimate: "neutral",
};

export const PROVIDER_SOURCE_LABEL: Record<SeoProviderSource, string> = {
  null_provider: "Estimated (no provider configured)",
  search_console: "Search Console",
  dataforseo: "DataForSEO",
  semrush: "Semrush",
  ahrefs: "Ahrefs",
  serper: "Serper",
  manual: "Manual",
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

const OPPORTUNITY_TYPE_LABEL: Record<string, string> = {
  service_page: "Service page",
  comparison_page: "Comparison page",
  use_case_page: "Use-case page",
  faq_page: "FAQ page",
};

/** `opportunity_type` is an open string server-side — today's generator
 *  (`classifyOpportunityType`) only ever produces the four values above, but
 *  a future provider or manually-created row could carry anything. Falls
 *  back to a humanized version of the raw value rather than a lookup miss,
 *  same defensive shape `data/query-universe/client.ts`'s `isQueryCategory`
 *  fallback uses for the same kind of "open string, closed UI vocabulary"
 *  gap. */
export function opportunityTypeLabel(type: string): string {
  return OPPORTUNITY_TYPE_LABEL[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The two check ids `technical-checklist.ts` invents for its own two NEW
 *  checks (not real `page_issues.issue_type` values — see that file's
 *  header comment). Every other check id in a `findings.checks` array is a
 *  real `IssueType`, looked up via Epic 3's own `ISSUE_TYPE_LABEL` instead of
 *  a second, potentially-drifting copy of those twelve labels. */
const SYNTHETIC_CHECK_LABEL: Record<string, string> = {
  https: "Served over HTTPS",
  homepage_organization_schema: "Homepage has Organization schema",
};

export function checkLabel(id: string): string {
  return (ISSUE_TYPE_LABEL as Record<string, string>)[id] ?? SYNTHETIC_CHECK_LABEL[id] ?? id.replace(/_/g, " ");
}

export const CHECK_SEVERITY_BADGE_VARIANT: Record<"low" | "medium" | "high", NonNullable<BadgeProps["variant"]>> = {
  high: "danger",
  medium: "warning",
  low: "outline",
};

export type ScoreTone = "success" | "warning" | "danger";

/** Shared score-coloring threshold — every score tile in this epic (page
 *  technical score, content score, opportunity score) reads the same way:
 *  >=80 good, 50-79 needs attention, <50 poor. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "danger";
}
