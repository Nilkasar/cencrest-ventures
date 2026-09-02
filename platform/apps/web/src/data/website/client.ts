import { ApiError } from "@/lib/api-client";
import {
  CRAWL_STEP_SCHEDULE,
  CRAWL_TOTAL_DURATION_MS,
  FIXTURE_FAILURE_AT_PAGE,
  FIXTURE_PAGES_FOUND,
  crawlBrand,
  generateCrawlResults,
  urlForPageIndex,
} from "./fixtures";
import type { CrawlJob, CrawlProgress, CrawlStep, IssueSeverity, Page, PageIssue, PageIssueWithPage } from "./types";

/**
 * The Website Intelligence data-access seam — same pattern as
 * `data/crm/client.ts`: every screen calls through here, never
 * `fixtures.ts` directly, so wiring `platform/apps/api`'s real
 * `POST /brands/:id/crawl` / `GET /crawl-jobs/:id` / `GET /brands/:id/pages`
 * routes (per `docs/epics/03-website-intelligence.md`'s "API surface")
 * later is a rewrite of this file's internals only:
 *
 *   export async function startCrawl(brandId: string) {
 *     return apiClient.post<CrawlJob>(`/brands/${brandId}/crawl`);
 *   }
 *
 * Until then: a `localStorage`-backed store per brand, with crawl
 * *progress* derived from elapsed wall-clock time against a fixed step
 * schedule (see `fixtures.ts`) rather than a `setInterval` mutating state —
 * that's what makes a mid-crawl page reload reconstruct the exact same
 * progress instead of losing it, the same way polling a real job's status
 * endpoint would.
 */

const STORAGE_PREFIX = "bebest.website-crawls.v1.";

interface StoredState {
  jobs: CrawlJob[];
  pagesByJob: Record<string, Page[]>;
  issuesByJob: Record<string, PageIssue[]>;
  /** Captured once, at `startCrawl` time, from `?bbDemoError=1` — so
   *  removing the query param mid-crawl doesn't change an already-started
   *  job's outcome. */
  simulateErrorByJob: Record<string, boolean>;
}

const LATENCY_MS = 400;

/** Append `?bbDemoError=1` before starting a crawl to see the failed-job
 *  state (a simulated SSRF-guard rejection partway through) — same
 *  convention as `data/crm/client.ts`'s `bbDemoError`. */
function shouldSimulateError(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("bbDemoError") === "1";
}

async function simulate<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  return value;
}

function emptyState(): StoredState {
  return { jobs: [], pagesByJob: {}, issuesByJob: {}, simulateErrorByJob: {} };
}

function storageKey(brandId: string): string {
  return `${STORAGE_PREFIX}${brandId}`;
}

export class CorruptedCrawlStoreError extends ApiError {
  constructor() {
    super(
      "Your saved crawl history couldn't be read (the local data looks corrupted). Resetting it will let you start a fresh crawl.",
      500,
    );
    this.name = "CorruptedCrawlStoreError";
  }
}

/** Real, triggerable failure mode (hand-edit `localStorage` to invalid JSON
 *  to see it) — same honesty standard as `onboarding-client.ts`'s
 *  corrupted-profile handling, not a simulated error. */
function loadState(brandId: string): StoredState {
  if (typeof window === "undefined") return emptyState();
  const raw = window.localStorage.getItem(storageKey(brandId));
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed || !Array.isArray(parsed.jobs)) throw new Error("shape mismatch");
    return parsed;
  } catch {
    throw new CorruptedCrawlStoreError();
  }
}

function saveState(brandId: string, state: StoredState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(brandId), JSON.stringify(state));
}

/** Escape hatch for the corrupted-store error panel's "Reset" action, and
 *  for manual testing. */
export function clearWebsiteCrawlHistory(brandId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(brandId));
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const STEP_OFFSETS: number[] = (() => {
  let cumulative = 0;
  return CRAWL_STEP_SCHEDULE.map((step) => {
    const offset = cumulative;
    cumulative += step.durationMs;
    return offset;
  });
})();

const CRAWLING_STEP_INDEX = CRAWL_STEP_SCHEDULE.findIndex((s) => s.key === "crawling");
const DISCOVERING_END_MS = STEP_OFFSETS[CRAWLING_STEP_INDEX]!;
const CRAWLING_DURATION_MS = CRAWL_STEP_SCHEDULE[CRAWLING_STEP_INDEX]!.durationMs;

const FAILURE_FRACTION = FIXTURE_FAILURE_AT_PAGE / FIXTURE_PAGES_FOUND;
const FAILURE_ELAPSED_MS = DISCOVERING_END_MS + FAILURE_FRACTION * CRAWLING_DURATION_MS;

const FAILURE_MESSAGE =
  "Crawl halted: a redirect on this site resolved to a private (RFC1918) address, and the SSRF guard refused to follow it. " +
  `${FIXTURE_FAILURE_AT_PAGE} of ${FIXTURE_PAGES_FOUND} discovered pages were fetched successfully before the job stopped.`;

interface ElapsedResult {
  terminal: boolean;
  status: CrawlJob["status"];
  pagesCrawled: number;
  pagesFound: number;
  errorMessage: string | null;
  completedAt: string | null;
  stepStates: CrawlStep["state"][];
  lastFetchedUrl: string | null;
}

/** Pure function of elapsed time — no I/O, no mutation. Given how long ago
 *  a job started, works out exactly what a real status-polling endpoint
 *  would report right now. */
function computeElapsedState(job: CrawlJob, simulateError: boolean, now: number): ElapsedResult {
  const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : now;
  const elapsed = now - startedMs;

  if (simulateError && elapsed >= FAILURE_ELAPSED_MS) {
    const stepStates = CRAWL_STEP_SCHEDULE.map((_, i) =>
      i < CRAWLING_STEP_INDEX ? "done" : i === CRAWLING_STEP_INDEX ? "failed" : "pending",
    ) as CrawlStep["state"][];
    return {
      terminal: true,
      status: "failed",
      pagesCrawled: FIXTURE_FAILURE_AT_PAGE,
      pagesFound: FIXTURE_PAGES_FOUND,
      errorMessage: FAILURE_MESSAGE,
      completedAt: new Date(startedMs + FAILURE_ELAPSED_MS).toISOString(),
      stepStates,
      lastFetchedUrl: null,
    };
  }

  if (elapsed >= CRAWL_TOTAL_DURATION_MS) {
    return {
      terminal: true,
      status: "completed",
      pagesCrawled: FIXTURE_PAGES_FOUND,
      pagesFound: FIXTURE_PAGES_FOUND,
      errorMessage: null,
      completedAt: new Date(startedMs + CRAWL_TOTAL_DURATION_MS).toISOString(),
      stepStates: CRAWL_STEP_SCHEDULE.map(() => "done") as CrawlStep["state"][],
      lastFetchedUrl: null,
    };
  }

  let currentIndex = CRAWL_STEP_SCHEDULE.length - 1;
  for (let i = 0; i < CRAWL_STEP_SCHEDULE.length; i++) {
    const start = STEP_OFFSETS[i]!;
    const end = start + CRAWL_STEP_SCHEDULE[i]!.durationMs;
    if (elapsed < end) {
      currentIndex = i;
      break;
    }
  }

  const stepStates = CRAWL_STEP_SCHEDULE.map((_, i) =>
    i < currentIndex ? "done" : i === currentIndex ? "active" : "pending",
  ) as CrawlStep["state"][];

  const pagesFound = elapsed >= DISCOVERING_END_MS ? FIXTURE_PAGES_FOUND : 0;
  let pagesCrawled = 0;
  let lastFetchedUrl: string | null = null;
  if (currentIndex === CRAWLING_STEP_INDEX) {
    const withinStep = elapsed - DISCOVERING_END_MS;
    const fraction = Math.min(1, Math.max(0, withinStep / CRAWLING_DURATION_MS));
    pagesCrawled = Math.floor(fraction * FIXTURE_PAGES_FOUND);
    if (pagesCrawled > 0) {
      lastFetchedUrl = urlForPageIndex(pagesCrawled - 1);
    }
  } else if (currentIndex > CRAWLING_STEP_INDEX) {
    pagesCrawled = FIXTURE_PAGES_FOUND;
  }

  return {
    terminal: false,
    status: currentIndex === 0 ? "pending" : "running",
    pagesCrawled,
    pagesFound,
    errorMessage: null,
    completedAt: null,
    stepStates,
    lastFetchedUrl,
  };
}

function stepsFromStates(states: CrawlStep["state"][]): CrawlStep[] {
  return CRAWL_STEP_SCHEDULE.map((def, i) => ({
    key: def.key,
    label: def.label,
    description: def.description,
    state: states[i]!,
  }));
}

/** Resolves one job to its current, accurate state — mutating and
 *  persisting the store exactly once, the moment a job first becomes
 *  terminal (so results are generated once, not regenerated on every
 *  poll). Already-terminal jobs are returned as-is with no recomputation. */
function resolveJob(state: StoredState, job: CrawlJob): { job: CrawlJob; progress: CrawlProgress; mutated: boolean } {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    const failedAt = job.status === "failed" ? CRAWLING_STEP_INDEX : -1;
    const states = CRAWL_STEP_SCHEDULE.map((_, i) =>
      failedAt >= 0 && i > failedAt ? "pending" : failedAt >= 0 && i === failedAt ? "failed" : "done",
    ) as CrawlStep["state"][];
    return { job, progress: { job, steps: stepsFromStates(states), lastFetchedUrl: null }, mutated: false };
  }

  const simulateError = state.simulateErrorByJob[job.id] ?? false;
  const elapsedState = computeElapsedState(job, simulateError, Date.now());

  if (!elapsedState.terminal) {
    const liveJob: CrawlJob = {
      ...job,
      status: elapsedState.status,
      pagesCrawled: elapsedState.pagesCrawled,
      pagesFound: elapsedState.pagesFound,
    };
    return {
      job: liveJob,
      progress: { job: liveJob, steps: stepsFromStates(elapsedState.stepStates), lastFetchedUrl: elapsedState.lastFetchedUrl },
      mutated: false,
    };
  }

  const finalJob: CrawlJob = {
    ...job,
    status: elapsedState.status,
    pagesCrawled: elapsedState.pagesCrawled,
    pagesFound: elapsedState.pagesFound,
    errorMessage: elapsedState.errorMessage,
    completedAt: elapsedState.completedAt,
    updatedAt: nowIso(),
  };
  const { pages, issues } = generateCrawlResults(job.id, elapsedState.pagesCrawled, elapsedState.completedAt ?? nowIso());
  state.pagesByJob[job.id] = pages;
  state.issuesByJob[job.id] = issues;
  state.jobs = state.jobs.map((j) => (j.id === job.id ? finalJob : j));
  return { job: finalJob, progress: { job: finalJob, steps: stepsFromStates(elapsedState.stepStates), lastFetchedUrl: null }, mutated: true };
}

export async function startCrawl(brandId: string): Promise<CrawlJob> {
  const state = loadState(brandId);
  const existing = state.jobs.find((j) => j.status === "pending" || j.status === "running");
  if (existing) return simulate(existing);

  const id = nextId("crawl");
  const timestamp = nowIso();
  const job: CrawlJob = {
    id,
    organizationId: crawlBrand.organizationId,
    brandId,
    rootUrl: crawlBrand.websiteUrl,
    status: "pending",
    pagesCrawled: 0,
    pagesFound: 0,
    errorMessage: null,
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.jobs = [job, ...state.jobs];
  state.simulateErrorByJob[id] = shouldSimulateError();
  saveState(brandId, state);
  return simulate(job);
}

export async function getLatestCrawlJob(brandId: string): Promise<CrawlJob | null> {
  const state = loadState(brandId);
  if (state.jobs.length === 0) return simulate(null);
  const latest = [...state.jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!;
  const { job, mutated } = resolveJob(state, latest);
  if (mutated) saveState(brandId, state);
  return simulate(job);
}

export async function listCrawlJobs(brandId: string): Promise<CrawlJob[]> {
  const state = loadState(brandId);
  let mutated = false;
  const resolved = state.jobs.map((j) => {
    const result = resolveJob(state, j);
    if (result.mutated) mutated = true;
    return result.job;
  });
  if (mutated) saveState(brandId, state);
  resolved.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return simulate(resolved);
}

/** The progress screen's poll target — mirrors `GET /crawl-jobs/:id`. */
export async function getCrawlProgress(jobId: string, brandId: string): Promise<CrawlProgress> {
  const state = loadState(brandId);
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) throw new ApiError(`Crawl job ${jobId} not found.`, 404);
  const { progress, mutated } = resolveJob(state, job);
  if (mutated) saveState(brandId, state);
  return simulate(progress);
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

const SEVERITY_ORDER: IssueSeverity[] = ["critical", "warning", "info"];

/** Mirrors `GET /brands/:id/pages` — "paginated, filterable by issue
 *  severity" — reshaped to an issue-centric list (one row per finding, each
 *  naming its page) since that's what the epic's UI surface actually asks
 *  for: "a page-issues list grouped by severity." */
export async function getPageIssues(brandId: string, jobId: string, filters: PageIssuesFilters = {}): Promise<PageIssuesResult> {
  const state = loadState(brandId);
  const pages = state.pagesByJob[jobId] ?? [];
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const allIssues = state.issuesByJob[jobId] ?? [];

  const bySeverity: Record<IssueSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of allIssues) bySeverity[issue.severity]++;

  const filtered = filters.severity && filters.severity !== "all" ? allIssues.filter((i) => i.severity === filters.severity) : allIssues;
  const sorted = [...filtered].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return (pageById.get(a.pageId)?.url ?? "").localeCompare(pageById.get(b.pageId)?.url ?? "");
  });

  const pageSize = filters.pageSize ?? sorted.length;
  const pageNum = filters.page ?? 1;
  const start = (pageNum - 1) * pageSize;
  const withPage: PageIssueWithPage[] = sorted.slice(start, start + pageSize).map((issue) => ({
    ...issue,
    page: pageById.get(issue.pageId)!,
  }));

  return simulate({ issues: withPage, total: sorted.length, bySeverity });
}
