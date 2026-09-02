/**
 * Epic 3 — Website Intelligence (Crawler) domain model.
 *
 * Post-verification fix: this file used to follow the ported Prisma
 * schema's PRE-Epic-3-backend field names/enum values (a mock era — see
 * `platform/docs/epics/03-website-intelligence-frontend.md`'s original
 * "Schema reconciliation" section for what that used to say). Epic 3's real
 * backend (`platform/apps/api/src/routes/{crawl,crawl-jobs,pages}.ts`) has
 * since landed and fixed the schema forward to the epic spec's literal text
 * — see `03-website-intelligence-backend.md`'s "Frontend contract
 * reconciliation needed" table. This file now matches that backend's actual
 * serializers exactly (verified by reading each route file, not guessed):
 *
 * - `CrawlJob.status` is `"queued" | "running" | "completed" | "failed" |
 *   "cancelled"` — was `"pending" | ...`.
 * - `PageIssue.severity` is `"low" | "medium" | "high"` — was
 *   `"critical" | "warning" | "info"`.
 * - `CrawlJob.error` (was `errorMessage`) — matches `crawl_jobs.error`.
 * - `Page.canonicalUrl` (was `canonical`) — matches `pages.canonical_url`.
 * - `CrawlJob.organizationId` dropped — neither route serializer
 *   (`serializeCrawlJob` in `routes/crawl.ts`/`routes/crawl-jobs.ts`)
 *   returns it.
 * - `Page.organizationId` / `Page.brandId` dropped — `serializePage` in
 *   `routes/pages.ts` returns neither; a page is already scoped to the one
 *   crawl job (and therefore the one brand/org) the caller asked for.
 * - `PageIssue.pageId` / `.organizationId` / `.brandId` / `.createdAt`
 *   dropped — `serializePage`'s nested `issues` array is
 *   `{ id, issueType, severity, detail }` only; an issue's page is already
 *   known from the `Page` it's nested under (`PageIssueWithPage.page`), and
 *   the API never returns a per-issue timestamp (the page's own
 *   `crawledAt` is the closest real signal for "when this was found").
 * - `Page.issues: PageIssue[]` added, and `Page.hasSchemaMarkup: boolean`
 *   added — both are real fields `serializePage` actually returns.
 * - `CrawlJob.progressPct` added (optional — only `GET /crawl-jobs/:id`
 *   computes it, not the `POST /brands/me/crawl` response).
 * - The `CrawlStep`/`CrawlStepKey`/`CrawlStepState`/`CrawlProgress` UI-only
 *   types are gone. They existed to synthesize a six-phase timeline
 *   (queued → validating → discovering → crawling → analyzing →
 *   finalizing) from a fake, fixed-duration clock
 *   (`computeElapsedState` in the old `client.ts`) — there was never a real
 *   backend signal for those six phases. The real crawl pipeline
 *   (`apps/api/src/lib/crawler/engine.ts`) only ever reports
 *   `status: "queued" | "running" | ...` plus the incrementally-updated
 *   `pagesCrawled` / `pagesFound` / `pagesFailed` counters — so the
 *   progress UI now renders `CrawlJob` directly instead of a synthesized
 *   step list. See `components/website/crawl-progress-panel.tsx`.
 * - `CrawlResultSummary` (unused anywhere in the app, and typed against the
 *   old `critical | warning | info` severities) is gone.
 */

export type CrawlJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CrawlJob {
  id: string;
  brandId: string;
  rootUrl: string;
  status: CrawlJobStatus;
  pagesCrawled: number;
  pagesFound: number;
  pagesFailed: number;
  /** Only present on `GET /crawl-jobs/:id` responses (`routes/crawl-jobs.ts`
   *  computes it); the `POST /brands/me/crawl` response that creates a job
   *  doesn't carry it yet, since nothing has run at that point. */
  progressPct?: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IssueSeverity = "low" | "medium" | "high";

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
  | "noindex"
  // Epic 4 (SEO Intelligence) additive values — `issue_type` gained these
  // two when `POST /brands/me/seo/analyze` shipped (see
  // `packages/database/DECISIONS.md` §20 and
  // `apps/api/src/lib/seo/technical-checklist.ts`). A page analyzed by that
  // route can carry either as a real `page_issues` row returned right here
  // from `GET /brands/me/pages` — this screen (and Epic 4's own technical
  // health drill-down) both need a real label for them, not the raw enum
  // string.
  | "not_https"
  | "missing_schema";

export interface PageIssue {
  id: string;
  issueType: IssueType;
  severity: IssueSeverity;
  detail: string | null;
}

export interface Page {
  id: string;
  crawlJobId: string;
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonicalUrl: string | null;
  statusCode: number | null;
  wordCount: number;
  loadMs: number | null;
  internalLinks: number;
  externalLinks: number;
  hasSchemaMarkup: boolean;
  schemaTypes: string[];
  crawledAt: string;
  issues: PageIssue[];
}

/** A `page_issues` row flattened back out with the parent `page` it came
 *  from — the shape the page-issues list actually renders (per the epic's
 *  UI surface: a list of issues grouped by severity, each one naming the
 *  page it's on). Built client-side in `data/website/client.ts` from
 *  `GET /brands/me/pages`'s page-centric response — the API has no
 *  issue-centric list endpoint of its own. */
export interface PageIssueWithPage extends PageIssue {
  page: Page;
}
