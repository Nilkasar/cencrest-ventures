/**
 * Epic 3 — Website Intelligence (Crawler) domain model.
 *
 * Field names follow the ported Prisma schema
 * (`packages/database/prisma/schema.prisma`'s "WEBSITE INTELLIGENCE
 * (crawler)" section) rather than `docs/epics/03-website-intelligence.md`'s
 * prose where the two disagree — same rule Epic 2's frontend completion doc
 * established ("this frontend was built against the spec's described shape
 * ... treat this file as the contract to reconcile toward" applies in
 * reverse here: the schema already exists, so it is the contract). Two
 * concrete divergences from the spec text:
 *
 * - `crawl_jobs.status` is `pending | running | completed | failed |
 *   cancelled` in the schema, not the spec prose's `queued | running |
 *   completed | failed`. UI copy still says "Queued" for `pending` — see
 *   `STATUS_LABEL` in `fixtures.ts` — the customer-facing word and the
 *   stored enum value are allowed to differ.
 * - `page_issues.severity` is `critical | warning | info` in the schema,
 *   not the spec prose's `low | medium | high`.
 * - The spec's domain model also lists a `sitemaps` table; no such model
 *   exists in the ported schema (checked — see
 *   `packages/database/DECISIONS.md`, which never mentions one). Not built
 *   here for the same reason Epic 2's frontend didn't build an `entities`
 *   onboarding step for a table the UI surface never actually asked for:
 *   flagged in `03-website-intelligence-frontend.md` for the backend to
 *   resolve, not silently dropped.
 */

export type CrawlJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface CrawlJob {
  id: string;
  organizationId: string;
  brandId: string;
  rootUrl: string;
  status: CrawlJobStatus;
  pagesCrawled: number;
  pagesFound: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Named phases of a single crawl, in order. Not a schema table — this is
 *  purely a UI concept, synthesized client-side from a job's timestamps so
 *  the progress screen can show real, distinct steps (per the epic's UI
 *  surface note: "not a generic spinner") instead of one bare percentage. */
export type CrawlStepKey = "queued" | "validating" | "discovering" | "crawling" | "analyzing" | "finalizing";

export type CrawlStepState = "pending" | "active" | "done" | "failed";

export interface CrawlStep {
  key: CrawlStepKey;
  label: string;
  description: string;
  state: CrawlStepState;
}

/** Live view of a job in progress — what the progress screen polls for. */
export interface CrawlProgress {
  job: CrawlJob;
  steps: CrawlStep[];
  /** Only set while the "crawling" step is active — the most recently
   *  fetched URL, for the "just fetched: /blog/post-4" live-status line. */
  lastFetchedUrl: string | null;
}

export type IssueSeverity = "critical" | "warning" | "info";

export type IssueType =
  | "missing_title"
  | "missing_meta"
  | "duplicate_title"
  | "missing_canonical"
  | "broken_link"
  | "redirect_chain"
  | "missing_alt"
  | "missing_h1"
  | "title_too_long"
  | "meta_too_long"
  | "thin_content"
  | "noindex";

export interface Page {
  id: string;
  organizationId: string;
  crawlJobId: string;
  brandId: string;
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  statusCode: number | null;
  wordCount: number;
  loadMs: number | null;
  internalLinks: number;
  externalLinks: number;
  schemaTypes: string[];
  crawledAt: string;
}

export interface PageIssue {
  id: string;
  organizationId: string;
  brandId: string;
  pageId: string;
  issueType: IssueType;
  severity: IssueSeverity;
  detail: string | null;
  createdAt: string;
}

/** A `page_issues` row joined with its parent `page` — the shape the
 *  page-issues list actually renders (per the epic's UI surface: a list of
 *  issues grouped by severity, each one naming the page it's on). */
export interface PageIssueWithPage extends PageIssue {
  page: Page;
}

export interface CrawlResultSummary {
  jobId: string;
  totalPages: number;
  issuesBySeverity: Record<IssueSeverity, number>;
  totalIssues: number;
}
