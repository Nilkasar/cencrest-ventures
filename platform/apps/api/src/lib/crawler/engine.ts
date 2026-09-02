/**
 * The Epic 3 crawl engine — the ONLY code path that walks a customer's
 * website. Every outbound request goes through `safeFetch` (ssrf-guard.ts);
 * this file itself never calls `fetch` directly (grep for it — see
 * docs/epics/03-website-intelligence-backend.md's "grep-verified" note).
 *
 * Enforces every crawl limit from docs/epics/03-website-intelligence.md:
 *   - max depth 3
 *   - max 500 pages
 *   - max 2 requests/sec
 *   - respects robots.txt
 *   - rejects pages >5MB (enforced inside safeFetch itself)
 *   - sanitizes extracted HTML before storage (html-extract.ts)
 *
 * Only same-origin links (`html-extract.ts`'s `internalLinks`) are ever
 * enqueued — this is a "Website Intelligence" audit of the customer's OWN
 * site, not a general-purpose web crawler, so off-site links are counted
 * (`external_links`) but never followed. This does not weaken the SSRF
 * story: a same-origin page can still redirect off-site into a private
 * address, and `safeFetch` re-validates every redirect hop regardless of
 * origin (ssrf-guard.ts's own "blocks a redirect to a private address"
 * test covers that in isolation; engine.test.ts's fixture-site test
 * exercises the same thing end to end via a same-origin page that
 * redirects off-site).
 *
 * Runs via `setImmediate` today (see routes/crawl.ts) — there is no durable
 * queue wired into apps/api yet (grepped for pg-boss/bullmq at spec time:
 * neither is a dependency anywhere in the monorepo). This is the same
 * documented, honest placeholder Epic 0 used for `background_jobs`:
 * `// TODO: replace with durable queue (pg-boss)`. A process crash mid-crawl
 * currently loses that job's progress (it stays `running` forever) — a real
 * queue with a heartbeat/retry is the fix, tracked in the backend doc's
 * "not done" list, not solved here.
 */

import { withOrgContext, type issue_severity, type issue_type } from '@bebest/database';
import { safeFetch, SsrfBlockedError, PageTooLargeError } from '../ssrf-guard.js';
import { parseRobotsTxt, CRAWLER_USER_AGENT, type RobotsRules } from '../robots.js';
import { extractPageData } from '../html-extract.js';
import type { SafeFetchOptions } from '../ssrf-guard.js';

export const MAX_CRAWL_DEPTH = 3;
export const MAX_PAGES = 500;
export const MAX_REQUESTS_PER_SECOND = 2;
const MIN_REQUEST_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND;
const MAX_FAILURE_SUMMARY_ITEMS = 10;

export interface CrawlEngineDeps {
  /** Injected for testing — see safeFetch's own FetchLike/DnsResolver docs.
   * Defaults to the real network in production. */
  fetchImpl?: SafeFetchOptions['fetchImpl'];
  resolveImpl?: SafeFetchOptions['resolveImpl'];
  /** Injectable clock/delay so tests don't actually wait for the 2 req/sec
   * rate limit. Defaults to real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

interface QueueItem {
  url: string;
  depth: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one crawl job to completion (or failure), writing all progress
 * incrementally so `GET /crawl-jobs/:id` reflects real progress mid-run,
 * not a single jump from 0% to 100% (docs/epics/03-website-intelligence.md's
 * UI surface requirement). A single page's SSRF-block/timeout/size error
 * never aborts the whole job — it's counted in `pages_failed` and
 * summarized in `error`; only a failure to fetch the ROOT url at all fails
 * the entire job (there is nothing to crawl).
 */
export async function runCrawlJob(
  jobId: string,
  organizationId: string,
  brandId: string,
  rootUrl: string,
  deps: CrawlEngineDeps = {},
): Promise<void> {
  const fetchOpts: SafeFetchOptions = {
    fetchImpl: deps.fetchImpl,
    resolveImpl: deps.resolveImpl,
    init: { headers: { 'User-Agent': CRAWLER_USER_AGENT } },
  };
  const sleep = deps.sleep ?? defaultSleep;

  await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.update({ where: { id: jobId }, data: { status: 'running', started_at: new Date() } }),
  );

  const failures: string[] = [];
  let pagesCrawled = 0;
  let pagesFound = 1; // the root URL itself
  let pagesFailed = 0;
  let lastRequestAt = 0;

  /** Returns the fetch result alongside `loadMs` timed from the actual
   * request (after the rate-limit wait, not including it) — the number
   * that belongs in `pages.load_ms`, not wall-clock-since-queued. */
  async function throttledSafeFetch(url: string): Promise<{ result: Awaited<ReturnType<typeof safeFetch>>; loadMs: number }> {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const requestStartedAt = lastRequestAt;
    const result = await safeFetch(url, fetchOpts);
    return { result, loadMs: Date.now() - requestStartedAt };
  }

  // --- robots.txt (best-effort: unreachable/missing robots.txt allows all) ---
  let robots: RobotsRules = { isAllowed: () => true, sitemapUrls: [] };
  try {
    const robotsUrl = new URL('/robots.txt', rootUrl).toString();
    const { result: res } = await throttledSafeFetch(robotsUrl);
    if (res.status >= 200 && res.status < 300) {
      robots = parseRobotsTxt(res.body);
    }
  } catch {
    // No robots.txt, or it's blocked/unreachable — proceed as allow-all,
    // matching standard crawler behavior (a missing robots.txt is not a
    // disallow).
  }

  await refreshSitemaps(organizationId, brandId, rootUrl, robots, fetchOpts);

  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: rootUrl, depth: 0 }];
  let rootFetchFailed: string | null = null;

  const seenTitles = new Map<string, string[]>(); // title -> page ids, for duplicate_title

  while (queue.length > 0 && pagesCrawled < MAX_PAGES) {
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
    let loadMs = 0;
    try {
      ({ result: fetchResult, loadMs } = await throttledSafeFetch(item.url));
    } catch (err) {
      pagesFailed++;
      const reason =
        err instanceof SsrfBlockedError || err instanceof PageTooLargeError ? err.message : (err as Error).message;
      if (failures.length < MAX_FAILURE_SUMMARY_ITEMS) failures.push(`${item.url}: ${reason}`);
      if (item.url === rootUrl) rootFetchFailed = reason;
      await updateProgress(organizationId, jobId, { pagesCrawled, pagesFound, pagesFailed });
      continue;
    }

    const extracted = extractPageData(fetchResult.body, fetchResult.finalUrl);

    const page = await withOrgContext(organizationId, (tx) =>
      tx.pages.create({
        data: {
          organization_id: organizationId,
          crawl_job_id: jobId,
          brand_id: brandId,
          url: fetchResult.finalUrl.slice(0, 2048),
          title: extracted.title,
          meta_description: extracted.metaDescription,
          h1: extracted.h1,
          canonical_url: extracted.canonicalUrl,
          status_code: fetchResult.status,
          word_count: extracted.wordCount,
          load_ms: loadMs,
          internal_links: extracted.internalLinks.length,
          external_links: extracted.externalLinkCount,
          schema_types: extracted.schemaTypes,
          raw_html_hash: extracted.rawHtmlHash,
        },
      }),
    );
    pagesCrawled++;

    if (extracted.title) {
      const list = seenTitles.get(extracted.title) ?? [];
      list.push(page.id);
      seenTitles.set(extracted.title, list);
    }

    await recordPageIssues(organizationId, brandId, page.id, fetchResult.status, extracted);

    if (item.depth < MAX_CRAWL_DEPTH) {
      for (const link of extracted.internalLinks) {
        if (!visited.has(normalizeUrl(link)) && pagesFound < MAX_PAGES) {
          queue.push({ url: link, depth: item.depth + 1 });
          pagesFound++;
        }
      }
    }

    await updateProgress(organizationId, jobId, { pagesCrawled, pagesFound, pagesFailed });
  }

  // Cross-page pass: duplicate_title issues (needs every page's title, so
  // it can only run after the crawl finishes).
  for (const [, pageIds] of seenTitles) {
    if (pageIds.length < 2) continue;
    await withOrgContext(organizationId, (tx) =>
      tx.page_issues.createMany({
        data: pageIds.map((pageId) => ({
          organization_id: organizationId,
          brand_id: brandId,
          page_id: pageId,
          issue_type: 'duplicate_title' as issue_type,
          severity: 'medium' as issue_severity,
          detail: `Shared with ${pageIds.length - 1} other page(s) in this crawl.`,
        })),
      }),
    );
  }

  const finalStatus = rootFetchFailed && pagesCrawled === 0 ? 'failed' : 'completed';
  const errorSummary = rootFetchFailed
    ? `Root URL could not be crawled: ${rootFetchFailed}`
    : failures.length > 0
      ? `${pagesFailed} page(s) failed: ${failures.join('; ')}`
      : null;

  await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        pages_crawled: pagesCrawled,
        pages_found: pagesFound,
        pages_failed: pagesFailed,
        error: errorSummary,
        completed_at: new Date(),
      },
    }),
  );
}

async function updateProgress(
  organizationId: string,
  jobId: string,
  progress: { pagesCrawled: number; pagesFound: number; pagesFailed: number },
): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.crawl_jobs.update({
      where: { id: jobId },
      data: {
        pages_crawled: progress.pagesCrawled,
        pages_found: progress.pagesFound,
        pages_failed: progress.pagesFailed,
      },
    }),
  );
}

async function recordPageIssues(
  organizationId: string,
  brandId: string,
  pageId: string,
  statusCode: number,
  extracted: ReturnType<typeof extractPageData>,
): Promise<void> {
  const issues: Array<{ issue_type: issue_type; severity: issue_severity; detail: string | null }> = [];

  if (statusCode >= 400) {
    issues.push({ issue_type: 'broken_link', severity: 'high', detail: `HTTP ${statusCode}` });
  }
  if (!extracted.title) {
    issues.push({ issue_type: 'missing_title', severity: 'high', detail: null });
  } else if (extracted.title.length > 60) {
    issues.push({ issue_type: 'title_too_long', severity: 'low', detail: `${extracted.title.length} characters` });
  }
  if (!extracted.metaDescription) {
    issues.push({ issue_type: 'missing_meta', severity: 'medium', detail: null });
  } else if (extracted.metaDescription.length > 160) {
    issues.push({
      issue_type: 'meta_too_long',
      severity: 'low',
      detail: `${extracted.metaDescription.length} characters`,
    });
  }
  if (!extracted.h1) {
    issues.push({ issue_type: 'missing_h1', severity: 'medium', detail: null });
  }
  if (!extracted.canonicalUrl) {
    issues.push({ issue_type: 'missing_canonical', severity: 'low', detail: null });
  }
  if (extracted.wordCount < 300) {
    issues.push({ issue_type: 'thin_content', severity: 'medium', detail: `${extracted.wordCount} words` });
  }
  if (extracted.isNoindex) {
    issues.push({ issue_type: 'noindex', severity: 'medium', detail: null });
  }
  if (extracted.imagesMissingAlt > 0) {
    issues.push({
      issue_type: 'missing_alt',
      severity: 'low',
      detail: `${extracted.imagesMissingAlt} of ${extracted.imagesTotal} image(s) missing alt text`,
    });
  }

  if (issues.length === 0) return;

  await withOrgContext(organizationId, (tx) =>
    tx.page_issues.createMany({
      data: issues.map((issue) => ({
        organization_id: organizationId,
        brand_id: brandId,
        page_id: pageId,
        ...issue,
      })),
    }),
  );
}

/** Discovers and upserts sitemap references for the brand — best-effort,
 * never fails the crawl job. Checks robots.txt's `Sitemap:` directives
 * first, falling back to the conventional `/sitemap.xml` path. Counts
 * `<loc>` occurrences as a cheap proxy for `url_count` rather than fully
 * parsing (and validating) the sitemap XML — a real XML parser is out of
 * scope for this pass, see docs/epics/03-website-intelligence-backend.md. */
async function refreshSitemaps(
  organizationId: string,
  brandId: string,
  rootUrl: string,
  robots: RobotsRules,
  fetchOpts: SafeFetchOptions,
): Promise<void> {
  const candidates =
    robots.sitemapUrls.length > 0 ? robots.sitemapUrls : [new URL('/sitemap.xml', rootUrl).toString()];

  for (const candidateUrl of candidates.slice(0, 5)) {
    try {
      const res = await safeFetch(candidateUrl, fetchOpts);
      if (res.status < 200 || res.status >= 300) continue;
      const urlCount = (res.body.match(/<loc>/gi) ?? []).length;
      await withOrgContext(organizationId, (tx) =>
        tx.sitemaps.upsert({
          where: { brand_id_url: { brand_id: brandId, url: candidateUrl.slice(0, 2048) } },
          create: {
            organization_id: organizationId,
            brand_id: brandId,
            url: candidateUrl.slice(0, 2048),
            url_count: urlCount,
            last_fetched_at: new Date(),
          },
          update: { url_count: urlCount, last_fetched_at: new Date() },
        }),
      );
    } catch {
      // Sitemap discovery is best-effort — a blocked/missing/oversized
      // sitemap must never fail the crawl job itself.
    }
  }
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
