import { apiClient, ApiError } from "@/lib/api-client";
import type { CrawlJob, CrawlJobStatus, IssueSeverity, Page, PageIssue, PageIssueWithPage } from "./types";

/**
 * The Website Intelligence data-access seam — same role as
 * `data/crm/client.ts`/`lib/onboarding-client.ts`: every screen calls
 * through here, never `apiClient` directly.
 *
 * Post-verification fix: this file used to be a pure `localStorage` mock
 * (fake brand, a compressed 26-second crawl schedule, a deterministic
 * page/issue generator) that never called `platform/apps/api` at all — see
 * `platform/docs/epics/03-website-intelligence-frontend.md`'s
 * "Post-verification fixes" section for the full account of what changed.
 * It now calls the real, tested routes
 * (`apps/api/src/routes/{crawl,crawl-jobs,pages}.ts`):
 *
 *   POST /api/brands/me/crawl        → startCrawl()
 *   GET  /api/crawl-jobs/:id         → getCrawlJob()
 *   GET  /api/brands/me/crawl-jobs   → listCrawlJobs() / getLatestCrawlJob()
 *   GET  /api/brands/me/pages        → getPageIssues() (paginates through it)
 *
 * All four resolve "the" brand from the caller's own org via
 * `lib/brand-context.ts` server-side (the established `/brands/me/*`
 * convention — see `routes/crawl.ts`'s own comment) — no `brandId` is ever
 * sent on the wire, so none of these functions take one.
 *
 * Epic 19 (Production Hardening) fix: this file used to work around a real
 * gap — no server-side "list crawl jobs for this brand" route existed, only
 * "create one" and "look one up by its own id" — with a small
 * `localStorage`-tracked pointer list of job ids the browser had seen.
 * Losing that list (a cleared browser, a different device) lost the
 * *history view* only, never correctness, but it was still a real gap: a
 * different device could never see this org's crawl history at all.
 * `GET /brands/me/crawl-jobs` (`docs/epics/19-production-hardening.md`
 * item 5) closes it — `listCrawlJobs`/`getLatestCrawlJob` below are real,
 * paginated, tenant-scoped server queries now. No client storage of any
 * kind is used for crawl history any more.
 */

// ── Wire shapes returned by apps/api's serializers ──────────────────────────
// Already camelCase and already the field names this app's `CrawlJob`/`Page`
// types use (see `types.ts`'s header for the reconciliation this required) —
// no `map*` translation layer is needed the way `onboarding-client.ts` needs
// one for nullable-vs-optional coercion, these come across as-is.

interface ApiCrawlJob {
  id: string;
  brandId: string;
  rootUrl: string;
  status: CrawlJob["status"];
  pagesCrawled: number;
  pagesFound: number;
  pagesFailed: number;
  progressPct?: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiPage {
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

interface ApiPagesResponse {
  pages: ApiPage[];
  pagination: { total: number; limit: number; offset: number };
}

interface CrawlAlreadyInProgressBody {
  error: "crawl_already_in_progress";
  message: string;
  crawlJobId: string;
}

/** `POST /brands/me/crawl` — kicks off a background crawl of the caller's
 *  brand's own `website_url`. Mirrors the old mock's "starting while one is
 *  already active just shows you the active one" behavior: the real API
 *  409s in that case (naming the existing job's id), so that's translated
 *  into a lookup of the existing job rather than a thrown error, matching
 *  what every call site here already expects `start()` to do. Any other
 *  failure (404 no brand, 422 no website_url set) is rethrown as-is — the
 *  caller's `ApiError` handling (`use-crawl-job.ts`) surfaces it. */
export async function startCrawl(): Promise<CrawlJob> {
  try {
    return await apiClient.post<ApiCrawlJob>("/brands/me/crawl");
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as CrawlAlreadyInProgressBody | undefined;
      if (body?.crawlJobId) {
        return getCrawlJob(body.crawlJobId);
      }
    }
    throw err;
  }
}

/** `GET /crawl-jobs/:id` — the progress screen's poll target (per the
 *  epic's UI surface: "real step-by-step status," now literally the real
 *  `pagesCrawled`/`pagesFound`/`pagesFailed`/`progressPct` this endpoint
 *  reports, not a synthesized timeline — see `crawl-progress-panel.tsx`). */
export async function getCrawlJob(jobId: string): Promise<CrawlJob> {
  return apiClient.get<ApiCrawlJob>(`/crawl-jobs/${jobId}`);
}

interface ApiCrawlJobsResponse {
  crawlJobs: ApiCrawlJob[];
  pagination: { total: number; limit: number; offset: number };
}

export interface ListCrawlJobsParams {
  status?: CrawlJobStatus;
  limit?: number;
  offset?: number;
}

export interface CrawlJobsPage {
  crawlJobs: CrawlJob[];
  pagination: { total: number; limit: number; offset: number };
}

/** `GET /brands/me/crawl-jobs` — real, paginated, tenant-scoped, newest
 *  first (Epic 19 item 5). A 404 (no brand profile yet) degrades to an
 *  empty page rather than an error, same "let the empty state carry it"
 *  precedent every other list fetcher in this codebase uses. */
export async function listCrawlJobs(params: ListCrawlJobsParams = {}): Promise<CrawlJobsPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<ApiCrawlJobsResponse>(`/brands/me/crawl-jobs?${query.toString()}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { crawlJobs: [], pagination: { total: 0, limit: params.limit ?? 25, offset: 0 } };
    }
    throw err;
  }
}

/** The single most recent crawl job for this brand, or `null` if none has
 *  ever run (the epic's "empty state before first crawl") — the progress
 *  screen's initial "does a job already exist" check. A thin wrapper over
 *  `listCrawlJobs({ limit: 1 })` now that a real list endpoint exists. */
export async function getLatestCrawlJob(): Promise<CrawlJob | null> {
  const { crawlJobs } = await listCrawlJobs({ limit: 1 });
  return crawlJobs[0] ?? null;
}

export interface PageIssuesFilters {
  severity?: IssueSeverity | "all";
  page?: number;
  pageSize?: number;
}

export interface PageIssuesResult {
  issues: PageIssueWithPage[];
  total: number;
  bySeverity: Record<IssueSeverity, number>;
}

const SEVERITY_ORDER: IssueSeverity[] = ["high", "medium", "low"];

/** `GET /brands/me/pages` paginates by PAGE (`limit`/`offset`, capped at
 *  100 per the route's own `listQuerySchema`), and its `severity` filter
 *  matches a page that has *at least one* issue of that severity — it has
 *  no issue-level aggregate of its own. The severity stat tiles need real
 *  per-issue counts, so this fetches every page for the job (paginating in
 *  100-row batches — at most 5 requests, since a crawl is capped at 500
 *  pages) and does the issue-level counting/filtering/pagination
 *  client-side, same shape `getPageIssues` always returned. */
async function fetchAllPagesForJob(jobId: string): Promise<Page[]> {
  const limit = 100;
  const pages: Page[] = [];
  let offset = 0;
  for (;;) {
    const query = new URLSearchParams({ crawlJobId: jobId, limit: String(limit), offset: String(offset) });
    const response = await apiClient.get<ApiPagesResponse>(`/brands/me/pages?${query.toString()}`);
    pages.push(...response.pages);
    offset += response.pages.length;
    if (response.pages.length === 0 || offset >= response.pagination.total) break;
  }
  return pages;
}

/** Mirrors `GET /brands/me/pages` — "paginated, filterable by issue
 *  severity" — reshaped to an issue-centric list (one row per finding, each
 *  naming its page) since that's what the epic's UI surface actually asks
 *  for: "a page-issues list grouped by severity." */
export async function getPageIssues(jobId: string, filters: PageIssuesFilters = {}): Promise<PageIssuesResult> {
  const pages = await fetchAllPagesForJob(jobId);
  const allIssues: PageIssueWithPage[] = pages.flatMap((page) => page.issues.map((issue) => ({ ...issue, page })));

  const bySeverity: Record<IssueSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const issue of allIssues) bySeverity[issue.severity]++;

  const filtered = filters.severity && filters.severity !== "all" ? allIssues.filter((i) => i.severity === filters.severity) : allIssues;
  const sorted = [...filtered].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    return sevDiff !== 0 ? sevDiff : a.page.url.localeCompare(b.page.url);
  });

  const pageSize = filters.pageSize ?? Math.max(sorted.length, 1);
  const pageNum = filters.page ?? 1;
  const start = (pageNum - 1) * pageSize;

  return { issues: sorted.slice(start, start + pageSize), total: sorted.length, bySeverity };
}
