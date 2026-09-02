import type { IssueSeverity, IssueType } from "./types";

/**
 * Display-only label/variant maps for Epic 3 (Website Intelligence).
 *
 * Post-verification fix: this file used to be `fixtures.ts` — a
 * `localStorage`-backed mock's fake brand, a compressed 26-second crawl
 * schedule, and a deterministic page/issue generator, none of which exist
 * anymore now that `data/website/client.ts` calls the real
 * `platform/apps/api` routes (see that file's header for the full account).
 * Renamed because nothing here is a "fixture" once there's a real backend
 * — these are just the customer-facing words for enum values the API
 * returns, the same role `STATUS_LABEL`/`SEVERITY_LABEL` always played.
 */

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  missing_title: "Missing title tag",
  missing_meta: "Missing meta description",
  duplicate_title: "Duplicate title tag",
  missing_canonical: "Missing canonical URL",
  broken_link: "Broken internal link",
  redirect_chain: "Redirect chain",
  missing_alt: "Image missing alt text",
  missing_h1: "Missing H1 heading",
  title_too_long: "Title tag too long",
  meta_too_long: "Meta description too long",
  thin_content: "Thin content",
  noindex: "Page marked noindex",
};
