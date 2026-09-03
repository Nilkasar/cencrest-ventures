/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the free-tier-scoped crawl step
 * (`docs/epics/17-free-snapshot.md` step 2b).
 *
 * This is deliberately NOT a call into `lib/crawler/engine.ts`'s
 * `runCrawlJob`: that function's entire contract is "one row per
 * `crawl_jobs`/`pages`/`page_issues`, tenant-scoped via `withOrgContext`,
 * FK'd to a real `brands` row owned by a real, authenticated user." A free
 * snapshot request has none of those — no `organization_id` (this is a
 * public, unauthenticated endpoint), no `brand_id` (Epic 2's brand profile
 * doesn't exist yet for an anonymous visitor), and `brands.created_by` is a
 * required, non-nullable FK to `users` with no "anonymous system user" to
 * point it at. Fabricating a throwaway `brands`/`crawl_jobs` row per
 * snapshot just to reuse `runCrawlJob` unmodified would pollute Epic 2/3's
 * tenant tables with data that was never really a customer's brand.
 *
 * What IS reused, exactly, per the epic brief's explicit instruction
 * ("reuse Epic 3's safeFetch/SSRF guard exactly — this is the highest-risk
 * public entry point in the system"): `safeFetch` (the SSRF guard itself,
 * unmodified), `parseRobotsTxt`/`CRAWLER_USER_AGENT` (the same robots.txt
 * policy), `extractPageData` (the same HTML sanitization/extraction), and
 * `detectPageIssues` (the exact same Page Analysis Checklist rules Epic 3
 * derives at crawl time — extracted from `engine.ts` into its own exported
 * function specifically so this module never re-implements those rules).
 * `MAX_CRAWL_DEPTH`/`MAX_REQUESTS_PER_SECOND` are Epic 3's own exported
 * crawl-politeness constants, reused as-is rather than re-declared.
 *
 * What is deliberately NOT reused/ported here — documented simplifications
 * of the full Epic 3 crawl, not silent omissions:
 *   - No `crawl_jobs`/`pages`/`page_issues` rows are ever written. The
 *     result lives only in memory for the duration of this one pipeline
 *     run, and is folded into `snapshot_requests.result_json` by the
 *     orchestrator (`orchestrator.ts`) — there is no durable per-page
 *     record for a free snapshot to browse later, only the summarized
 *     report.
 *   - No sitemap discovery (`engine.ts`'s `refreshSitemaps`) — sitemaps are
 *     a `brands`-owned resource (`sitemaps.brand_id` is required); nothing
 *     downstream of a free snapshot report needs sitemap URL counts.
 *   - No cross-page `duplicate_title` pass — a real, if minor, gap for a
 *     ~10-page sample; skipped to keep this module's only job "walk up to
 *     N pages and report per-page issues," not a second copy of engine.ts's
 *     whole orchestration.
 */
import { safeFetch, SsrfBlockedError, PageTooLargeError, type SafeFetchOptions } from '../ssrf-guard.js';
import { parseRobotsTxt, CRAWLER_USER_AGENT, type RobotsRules } from '../robots.js';
import { extractPageData, type ExtractedPage } from '../html-extract.js';
import { MAX_CRAWL_DEPTH, MAX_REQUESTS_PER_SECOND, detectPageIssues, type DetectedPageIssue } from '../crawler/engine.js';

const MIN_REQUEST_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND;
const MAX_FAILURE_SUMMARY_ITEMS = 10;

export interface FreeSnapshotCrawlDeps {
  /** Injected for testing — never real network access in a test run, same
   * hard constraint `lib/ssrf-guard.ts` itself is built around. */
  fetchImpl?: SafeFetchOptions['fetchImpl'];
  resolveImpl?: SafeFetchOptions['resolveImpl'];
  sleep?: (ms: number) => Promise<void>;
}

export interface FreeSnapshotPage {
  url: string;
  isHomepage: boolean;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonicalUrl: string | null;
  wordCount: number;
  schemaTypes: string[];
  issues: DetectedPageIssue[];
}

export interface FreeSnapshotCrawlResult {
  rootUrl: string;
  pages: FreeSnapshotPage[];
  pagesCrawled: number;
  pagesFailed: number;
  /** Set only when the ROOT url itself could not be fetched at all — same
   * "nothing to crawl" distinction `engine.ts` makes between a whole-job
   * failure and one page's fetch failing. */
  rootFetchFailed: string | null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface QueueItem {
  url: string;
  depth: number;
}

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Crawls up to `maxPages` pages of `rootUrl`, breadth-first, same-origin
 * links only — the free-tier-scoped analog of `engine.ts`'s `runCrawlJob`,
 * with no database writes. `maxPages` is a required parameter (never a
 * hardcoded module constant) specifically so the caller (the orchestrator)
 * is the one place that decides the free-tier cap, and so a test can prove
 * this function was invoked with the free-tier number rather than Epic 3's
 * `MAX_PAGES` (500).
 */
export async function crawlFreeSnapshotSite(
  rootUrl: string,
  maxPages: number,
  deps: FreeSnapshotCrawlDeps = {},
): Promise<FreeSnapshotCrawlResult> {
  const fetchOpts: SafeFetchOptions = {
    fetchImpl: deps.fetchImpl,
    resolveImpl: deps.resolveImpl,
    init: { headers: { 'User-Agent': CRAWLER_USER_AGENT } },
  };
  const sleep = deps.sleep ?? defaultSleep;

  let lastRequestAt = 0;
  async function throttledSafeFetch(url: string) {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return safeFetch(url, fetchOpts);
  }

  let robots: RobotsRules = { isAllowed: () => true, sitemapUrls: [] };
  try {
    const robotsUrl = new URL('/robots.txt', rootUrl).toString();
    const res = await throttledSafeFetch(robotsUrl);
    if (res.status >= 200 && res.status < 300) {
      robots = parseRobotsTxt(res.body);
    }
  } catch {
    // No robots.txt, or it's blocked/unreachable — proceed as allow-all,
    // matching engine.ts's identical handling.
  }

  const pages: FreeSnapshotPage[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: rootUrl, depth: 0 }];
  const normalizedRoot = normalizeUrl(rootUrl);
  let pagesFailed = 0;
  let rootFetchFailed: string | null = null;
  const failures: string[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (item.depth > MAX_CRAWL_DEPTH) continue;

    let path = '/';
    try {
      path = new URL(item.url).pathname;
    } catch {
      // fall through to safeFetch, which will reject the unparseable URL
    }
    if (!robots.isAllowed(path)) continue;

    let fetchResult;
    try {
      fetchResult = await throttledSafeFetch(item.url);
    } catch (err) {
      pagesFailed++;
      const reason =
        err instanceof SsrfBlockedError || err instanceof PageTooLargeError ? err.message : (err as Error).message;
      if (failures.length < MAX_FAILURE_SUMMARY_ITEMS) failures.push(`${item.url}: ${reason}`);
      if (normalized === normalizedRoot) rootFetchFailed = reason;
      continue;
    }

    const extracted: ExtractedPage = extractPageData(fetchResult.body, fetchResult.finalUrl);
    const isHomepage = normalizeUrl(fetchResult.finalUrl) === normalizedRoot;

    pages.push({
      url: fetchResult.finalUrl,
      isHomepage,
      statusCode: fetchResult.status,
      title: extracted.title,
      metaDescription: extracted.metaDescription,
      h1: extracted.h1,
      canonicalUrl: extracted.canonicalUrl,
      wordCount: extracted.wordCount,
      schemaTypes: extracted.schemaTypes,
      issues: detectPageIssues(extracted, fetchResult.status),
    });

    if (item.depth < MAX_CRAWL_DEPTH) {
      for (const link of extracted.internalLinks) {
        if (!visited.has(normalizeUrl(link)) && pages.length + queue.length < maxPages * 4) {
          // The `* 4` slack (not a literal page cap) only bounds how large
          // the in-memory queue itself can grow while still discovering
          // enough same-origin links to fill `maxPages` after some fail —
          // `pages.length < maxPages` (the while-loop condition above) is
          // the actual, authoritative page cap.
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    }
  }

  return {
    rootUrl,
    pages,
    pagesCrawled: pages.length,
    pagesFailed,
    rootFetchFailed: pages.length === 0 ? rootFetchFailed : null,
  };
}
