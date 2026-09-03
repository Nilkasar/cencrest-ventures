import type { BadgeProps } from "@bebest/ui";
import type { ContentBriefStatus, ContentDraftStatus, QualityCheckStatus, QualityCheckType } from "./types";

/** Display-only label/variant maps for Epic 11 (Content Intelligence &
 *  Generation) — same role `data/recommendations/labels.ts` plays for
 *  Epic 10. */

export const BRIEF_STATUS_LABEL: Record<ContentBriefStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  archived: "Archived",
};

export const BRIEF_STATUS_BADGE_VARIANT: Record<ContentBriefStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  in_review: "warning",
  approved: "success",
  archived: "outline",
};

/** `"landing_page" | "page_update"` — `contentTypeForActionType`,
 *  `apps/api/src/lib/content/brief-builder.ts`, derived 1:1 from the source
 *  recommendation's `create_page`/`update_page` action type. */
export const CONTENT_TYPE_LABEL: Record<string, string> = {
  landing_page: "New landing page",
  page_update: "Page update",
};

export function contentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABEL[contentType] ?? contentType;
}

export const DRAFT_STATUS_LABEL: Record<ContentDraftStatus, string> = {
  generated: "Awaiting approval",
  approved: "Approved — ready to publish",
};

export const DRAFT_STATUS_BADGE_VARIANT: Record<ContentDraftStatus, NonNullable<BadgeProps["variant"]>> = {
  generated: "warning",
  approved: "success",
};

export const QUALITY_CHECK_LABEL: Record<QualityCheckType, string> = {
  fact_check: "Fact check",
  brand_voice: "Brand voice",
  duplicate_content: "Duplicate content",
  seo_checklist: "SEO checklist",
  geo_structure: "GEO structure",
};

/** Fixed run order `runAllQualityChecks` always uses
 *  (`apps/api/src/lib/content/quality-checks.ts`) — rendered in this same
 *  order everywhere so "all 5 ran, in this order" is visibly true, not just
 *  asserted by a test. */
export const QUALITY_CHECK_ORDER: QualityCheckType[] = [
  "fact_check",
  "brand_voice",
  "duplicate_content",
  "seo_checklist",
  "geo_structure",
];

export const QUALITY_CHECK_STATUS_LABEL: Record<QualityCheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  warning: "Warning",
};

export const QUALITY_CHECK_STATUS_BADGE_VARIANT: Record<QualityCheckStatus, NonNullable<BadgeProps["variant"]>> = {
  pass: "success",
  fail: "danger",
  warning: "warning",
};

/** Same wire format `data/recommendations/labels.ts`'s
 *  `splitImplementationNotes` already parses (`"SEO requirements: ...\n\nGEO
 *  requirements: ..."`) — a content brief's `implementationNotes` is the
 *  source recommendation's field, carried forward verbatim, so it shares
 *  the exact same split logic rather than a second, potentially-drifting
 *  copy of it. */
export function splitImplementationNotes(notes: string): { seo: string; geo: string } | null {
  const marker = "\n\nGEO requirements: ";
  const idx = notes.indexOf(marker);
  if (idx === -1) return null;
  const seo = notes.slice("SEO requirements: ".length, idx);
  const geo = notes.slice(idx + marker.length);
  return { seo, geo };
}
