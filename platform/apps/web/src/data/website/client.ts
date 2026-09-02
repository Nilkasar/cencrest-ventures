import { apiClient, ApiError } from "@/lib/api-client";
import type { CrawlJob, IssueSeverity, Page, PageIssue, PageIssueWithPage } from "./types";

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
 *   POST /api/brands/me/crawl   → startCrawl()
 *   GET  /api/crawl-jobs/:id    → getCrawlJob()
 *   GET  /api/brands/me/pages   → getPageIssues() (paginates through it)
 *
 * All three resolve "the" brand from the caller's own org via
 * `lib/brand-context.ts` server-side (the established `/brands/me/*`
 * convention — see `routes/crawl.ts`'s own comment) — no `brandId` is ever
 * sent on the wire, so none of these functions take one.
 *
 * One real gap this file works around, not just a naming mismatch: this
 * epic's API surface (`docs/epics/03-website-intelligence.md`) has no
 * "list crawl jobs for this brand" route — only "create one" and "look one
 * up by its own id." So there is no server-side answer to "what job should
 * the progress screen resume watching on page load?" or "what past crawls
 * belong in the history table?". This file keeps a small, per-organization
 * `localStorage` list of job ids the browser has seen (via `startCrawl`'s
 * response, or the `crawlJobId` a 409 names) — a pointer list only, never a
 * cache of job data. Every field ever rendered still comes from a fresh
 * `GET /crawl-jobs/:id` call; an id that 404s (wrong org, or genuinely
 * gone) is quietly dropped from the list. Losing this list (a cleared
 * browser, a different device) loses the *history view*, never correctness
 * — the underlying `crawl_jobs` rows are exactly what the spec's end-to-end
 * flow step 5 says they are, preserved in the database regardless of what
 * this browser remembers.
 */

const TRACKED_JOBS_PREFIX = "bebest.website-crawl-job-ids.v1.";
const MAX_TRACKED_JOBS = 20;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function trackedJobsKey(organizationId: string): string {
  return `${TRACKED_JOBS_PREFIX}${organizationId}`;
}

/** Most-recently-tracked id first. A corrupted or missing entry is treated
 *  as "no history yet," not an error — this is a recoverable pointer list,
 *  not the data itself (contrast the old mock's `CorruptedCrawlStoreError`,
 *  which had to be a hard failure because the *entire* crawl result set
 *  lived only in that JSON blob). */
function readTrackedJobIds(organizationId: string): string[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(trackedJobsKey(organizationId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeTrackedJobIds(organizationId: string, ids: string[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(trackedJobsKey(organizationId), JSON.stringify(ids));
  } catch {
    // Storage full/blocked — worst case this job drops out of the history
    // view; the real crawl_jobs row is unaffected.
  }
}

function recordJobId(organizationId: string, jobId: string): void {
  const existing = readTrackedJobIds(organizationId);
  writeTrackedJobIds(organizationId, [jobId, ...existing.filter((id) => id !== jobId)].slice(0, MAX_TRACKED_JOBS));
}

function forgetJobId(organizationId: string, jobId: string): void {
  writeTrackedJobIds(
    organizationId,
    readTrackedJobIds(organizationId).filter((id) => id !== jobId),
  );
}

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
export async function startCrawl(organizationId: string): Promise<CrawlJob> {
  try {
    const created = await apiClient.post<ApiCrawlJob>("/brands/me/crawl");
    recordJobId(organizationId, created.id);
    return created;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as CrawlAlreadyInProgressBody | undefined;
      if (body?.crawlJobId) {
        recordJobId(organizationId, body.crawlJobId);
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

/** The most recently tracked job for this org, refetched live — `null` if
 *  none is tracked (the epic's "empty state before first crawl") or every
 *  tracked id has since 404'd. */
export async function getLatestCrawlJob(organizationId: string): Promise<CrawlJob | null> {
  for (const id of readTrackedJobIds(organizationId)) {
    try {
      return await getCrawlJob(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        forgetJobId(organizationId, id);
        continue;
      }
      throw err;
    }
  }
  return null;
}

/** Every job this browser has tracked for this org, refetched live and
 *  sorted newest-first — the crawl-history table's data source. See this
 *  file's header for why the source list is `localStorage`-tracked ids
 *  rather than a server-side list query (no such route exists). */
export async function listCrawlJobs(organizationId: string): Promise<CrawlJob[]> {
  const trackedIds = readTrackedJobIds(organizationId);
  const jobs: CrawlJob[] = [];
  const stillValid: string[] = [];
  for (const id of trackedIds) {
    try {
      jobs.push(await getCrawlJob(id));
      stillValid.push(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      // Dropped — see forgetJobId's callers above for the same rule.
    }
  }
  if (stillValid.length !== trackedIds.length) writeTrackedJobIds(organizationId, stillValid);
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return jobs;
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
