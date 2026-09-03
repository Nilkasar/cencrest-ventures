import { describe, expect, it, vi } from 'vitest';
import { crawlFreeSnapshotSite } from './crawl.js';

const ROOT = 'https://acme.example/';

function html(opts: { title?: string; meta?: string; h1?: string; words?: number; links?: string[] }): string {
  const body = 'word '.repeat(opts.words ?? 400);
  const links = (opts.links ?? []).map((href) => `<a href="${href}">link</a>`).join('\n');
  return `<html><head>
    ${opts.title ? `<title>${opts.title}</title>` : ''}
    ${opts.meta ? `<meta name="description" content="${opts.meta}">` : ''}
  </head><body>${opts.h1 ? `<h1>${opts.h1}</h1>` : ''}<p>${body}</p>${links}</body></html>`;
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const fastSleep = vi.fn().mockResolvedValue(undefined);

describe('crawlFreeSnapshotSite', () => {
  it('caps discovery at maxPages, never Epic 3\'s 500-page MAX_PAGES, on a site with more same-origin links than the cap', async () => {
    const resolveImpl = vi.fn(async (hostname: string) => {
      if (hostname === 'acme.example') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error(`ENOTFOUND ${hostname}`);
    });

    const links = Array.from({ length: 20 }, (_, i) => `/page-${i}`);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://acme.example/robots.txt') return jsonResponse(404, 'not found');
      if (url === ROOT) {
        return jsonResponse(200, html({ title: 'Acme', meta: 'Acme homepage', h1: 'Welcome', words: 400, links }));
      }
      // Every discovered sub-page is a valid, fully-formed page — if the
      // cap didn't hold, all 20 (plus root) would be fetched.
      return jsonResponse(200, html({ title: 'Sub', meta: 'Sub page', h1: 'Sub', words: 400 }));
    });

    const result = await crawlFreeSnapshotSite(ROOT, 3, { fetchImpl, resolveImpl, sleep: fastSleep });

    expect(result.pages).toHaveLength(3);
    expect(result.pagesCrawled).toBe(3);
    // robots.txt (1) + root (1) + exactly 2 more sub-pages to reach the cap
    // of 3 total pages — never anywhere near all 20 discovered links.
    expect(fetchImpl.mock.calls.length).toBeLessThan(6);
  });

  it('reuses the exact SSRF guard: a same-origin page that redirects to a private-IP-resolving host is blocked, never fetched, and counted as failed, not crawled', async () => {
    const resolveImpl = vi.fn(async (hostname: string) => {
      if (hostname === 'acme.example') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'internal.acme.example') return [{ address: '10.0.0.5', family: 4 }];
      throw new Error(`ENOTFOUND ${hostname}`);
    });

    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://acme.example/robots.txt') return jsonResponse(404, 'not found');
      if (url === ROOT) {
        return jsonResponse(
          200,
          html({ title: 'Acme', meta: 'Acme homepage', h1: 'Welcome', words: 400, links: ['/redirect-away'] }),
        );
      }
      if (url === 'https://acme.example/redirect-away') {
        return new Response(null, { status: 302, headers: { location: 'https://internal.acme.example/secret' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await crawlFreeSnapshotSite(ROOT, 10, { fetchImpl, resolveImpl, sleep: fastSleep });

    // The private-address target was never actually requested.
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('internal.acme.example'))).toBe(false);
    expect(result.pages.map((p) => p.url)).toEqual([ROOT]);
    expect(result.pagesFailed).toBe(1);
  });

  it('detects page issues using the exact same rules as Epic 3\'s crawler (detectPageIssues)', async () => {
    const resolveImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://acme.example/robots.txt') return jsonResponse(404, 'not found');
      // No title, no meta description, no h1, thin content — should trip
      // several of `detectPageIssues`'s checks.
      return jsonResponse(200, '<html><body><p>short</p></body></html>');
    });

    const result = await crawlFreeSnapshotSite(ROOT, 1, { fetchImpl, resolveImpl, sleep: fastSleep });

    expect(result.pages).toHaveLength(1);
    const issueTypes = result.pages[0]!.issues.map((i) => i.issue_type);
    expect(issueTypes).toEqual(
      expect.arrayContaining(['missing_title', 'missing_meta', 'missing_h1', 'thin_content']),
    );
  });

  it('marks the whole crawl as root-fetch-failed only when the root itself never succeeds', async () => {
    const resolveImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const fetchImpl = vi.fn();

    const result = await crawlFreeSnapshotSite(ROOT, 5, { fetchImpl, resolveImpl, sleep: fastSleep });

    expect(result.pages).toHaveLength(0);
    expect(result.rootFetchFailed).toBeTruthy();
  });
});
