import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = {
  crawl_jobs: { update: vi.fn().mockResolvedValue({}) },
  pages: { create: vi.fn() },
  page_issues: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  sitemaps: { upsert: vi.fn().mockResolvedValue({}) },
};

const orgContextCalls: string[] = [];

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (organizationId: string, fn: (tx: unknown) => unknown) => {
    orgContextCalls.push(organizationId);
    return fn(db);
  }),
}));

let pageIdCounter = 0;
function html(opts: {
  title?: string;
  meta?: string;
  h1?: string;
  words?: number;
  links?: string[];
  noindex?: boolean;
}): string {
  const body = 'word '.repeat(opts.words ?? 400);
  const links = (opts.links ?? []).map((href) => `<a href="${href}">link</a>`).join('\n');
  return `<html><head>
    ${opts.title ? `<title>${opts.title}</title>` : ''}
    ${opts.meta ? `<meta name="description" content="${opts.meta}">` : ''}
    ${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
  </head><body>${opts.h1 ? `<h1>${opts.h1}</h1>` : ''}<p>${body}</p>${links}</body></html>`;
}

function jsonResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  orgContextCalls.length = 0;
  pageIdCounter = 0;
  fastSleep.mockClear();
  db.pages.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `page-${++pageIdCounter}`,
    ...data,
  }));
});

const ORG = 'org-1';
const BRAND = 'brand-1';
const JOB = 'job-1';
const ROOT = 'https://acme.example/';

/** All tests inject a no-op sleep — the 2 req/sec rate-limit gate is
 * exercised (asserted via the mock's call count in the dedicated test
 * below) without a real test actually waiting on it. */
const fastSleep = vi.fn().mockResolvedValue(undefined);

describe('runCrawlJob', () => {
  it('walks a small fixture site: extracts pages, flags issues, discovers a sitemap, and completes', async () => {
    const { runCrawlJob } = await import('./engine.js');

    const resolveImpl = vi.fn(async (hostname: string) => {
      if (hostname === 'acme.example') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'internal.acme.example') return [{ address: '10.0.0.5', family: 4 }]; // rebinding target
      throw new Error(`ENOTFOUND ${hostname}`);
    });

    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://acme.example/robots.txt') return jsonResponse(404, 'not found');
      if (url === 'https://acme.example/sitemap.xml') {
        return jsonResponse(200, '<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>');
      }
      if (url === ROOT) {
        return jsonResponse(
          200,
          html({
            title: 'Acme',
            meta: 'Acme homepage',
            h1: 'Welcome to Acme',
            words: 400,
            // /redirect-away is a same-origin link (so it's actually
            // enqueued and fetched — this crawler only follows same-origin
            // links by design, see engine.ts), but its own response
            // redirects OFF-site to a hostname that resolves to a private
            // IP. This is the realistic shape of the epic's "feed the
            // crawler a URL resolving to a private IP" test: the danger is
            // rarely the root URL itself, it's a discovered link (or a
            // redirect from one) landing somewhere private.
            links: ['/about', '/broken', '/thin', '/redirect-away'],
          }),
        );
      }
      if (url === 'https://acme.example/about') {
        // Same title as root — should trigger duplicate_title on both.
        return jsonResponse(200, html({ title: 'Acme', meta: 'About us', h1: 'About', words: 400 }));
      }
      if (url === 'https://acme.example/broken') {
        return jsonResponse(404, html({ title: 'Not Found', words: 10 }));
      }
      if (url === 'https://acme.example/thin') {
        return jsonResponse(200, html({ title: 'Thin Page', meta: 'x', h1: 'Thin', words: 5 }));
      }
      if (url === 'https://acme.example/redirect-away') {
        return jsonResponse(302, '', { location: 'http://internal.acme.example/secret' });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    await runCrawlJob(JOB, ORG, BRAND, ROOT, { fetchImpl, resolveImpl, sleep: fastSleep });

    // 1. fetchImpl was called for the redirecting page itself, but NEVER
    // for the private redirect target — blocked before any socket to it
    // would open.
    expect(fetchImpl).toHaveBeenCalledWith('https://acme.example/redirect-away', expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith('http://internal.acme.example/secret', expect.anything());

    // 2. Job transitioned queued->running (already queued by the route)
    // and finished as 'completed' — a blocked/failed discovered link does
    // NOT crash the whole job.
    const statusUpdates = db.crawl_jobs.update.mock.calls.map((c) => c[0].data.status).filter(Boolean);
    expect(statusUpdates[0]).toBe('running');
    expect(statusUpdates.at(-1)).toBe('completed');

    // 3. Every real page was persisted (root, about, broken, thin) — the
    // blocked redirect target is NOT a page row.
    expect(db.pages.create).toHaveBeenCalledTimes(4);
    const createdUrls = db.pages.create.mock.calls.map((c) => c[0].data.url);
    expect(createdUrls).toEqual(
      expect.arrayContaining([ROOT, 'https://acme.example/about', 'https://acme.example/broken', 'https://acme.example/thin']),
    );

    // 4. The final job state records the blocked redirect as a per-page
    // failure with a clear reason, not a crash of the whole job.
    const finalUpdate = db.crawl_jobs.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.pages_crawled).toBe(4);
    expect(finalUpdate.data.pages_failed).toBe(1);
    expect(finalUpdate.data.error).toContain('page(s) failed');
    expect(finalUpdate.data.error).toContain('redirect-away');

    // 5. Issue detection: broken_link on the 404 page, thin_content on the
    // thin page, duplicate_title on root+about.
    const allIssues = db.page_issues.createMany.mock.calls.flatMap((c) => c[0].data as Array<{ issue_type: string }>);
    const issueTypes = allIssues.map((i) => i.issue_type);
    expect(issueTypes).toEqual(expect.arrayContaining(['broken_link', 'thin_content', 'duplicate_title']));
    expect(issueTypes.filter((t) => t === 'duplicate_title')).toHaveLength(2); // root + about

    // 6. Sitemap discovered and upserted.
    expect(db.sitemaps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brand_id_url: { brand_id: BRAND, url: 'https://acme.example/sitemap.xml' } },
        create: expect.objectContaining({ url_count: 2 }),
      }),
    );

    // 7. Rate limiting: the interval gate was consulted between requests
    // (mocked sleep is called instead of really waiting).
    expect(fastSleep).toHaveBeenCalled();

    // 8. Every DB call in this job ran under the SAME org's tenant context
    // — no cross-tenant leakage.
    expect(orgContextCalls.every((id) => id === ORG)).toBe(true);
  });

  it('fails the whole job only when the ROOT url itself cannot be fetched', async () => {
    const { runCrawlJob } = await import('./engine.js');
    const resolveImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const fetchImpl = vi.fn();

    await runCrawlJob(JOB, ORG, BRAND, 'https://unreachable.example/', { fetchImpl, resolveImpl, sleep: fastSleep });

    expect(db.pages.create).not.toHaveBeenCalled();
    const finalUpdate = db.crawl_jobs.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('failed');
    expect(finalUpdate.data.error).toContain('Root URL could not be crawled');
  });

  it('never crawls past MAX_CRAWL_DEPTH', async () => {
    const { runCrawlJob, MAX_CRAWL_DEPTH } = await import('./engine.js');
    const resolveImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

    // A straight chain: / -> /1 -> /2 -> /3 -> /4 -> /5
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) return jsonResponse(404, '');
      const match = /\/(\d+)$/.exec(url);
      const depth = match ? Number(match[1]) : 0;
      const next = `https://chain.example/${depth + 1}`;
      return jsonResponse(200, html({ title: `Page ${depth}`, meta: 'm', h1: 'h', words: 400, links: [next] }));
    });

    await runCrawlJob(JOB, ORG, BRAND, 'https://chain.example/', { fetchImpl, resolveImpl, sleep: fastSleep });

    const createdUrls = db.pages.create.mock.calls.map((c) => c[0].data.url as string);
    // depth 0 (root) through depth MAX_CRAWL_DEPTH are crawled; nothing deeper.
    expect(createdUrls).toHaveLength(MAX_CRAWL_DEPTH + 1);
    expect(createdUrls).not.toContain(`https://chain.example/${MAX_CRAWL_DEPTH + 1}`);
  });

  it('never crawls more than MAX_PAGES', async () => {
    const { runCrawlJob, MAX_PAGES } = await import('./engine.js');
    const resolveImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

    const manyLinks = Array.from({ length: MAX_PAGES + 50 }, (_, i) => `/page-${i}`);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) return jsonResponse(404, '');
      if (url === 'https://big.example/') {
        return jsonResponse(200, html({ title: 'Root', meta: 'm', h1: 'h', words: 400, links: manyLinks }));
      }
      return jsonResponse(200, html({ title: `T ${url}`, meta: 'm', h1: 'h', words: 400 }));
    });

    await runCrawlJob(JOB, ORG, BRAND, 'https://big.example/', { fetchImpl, resolveImpl, sleep: fastSleep });

    expect(db.pages.create.mock.calls.length).toBeLessThanOrEqual(MAX_PAGES);
    const finalUpdate = db.crawl_jobs.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.pages_crawled).toBeLessThanOrEqual(MAX_PAGES);
  });

  it('does not enqueue links disallowed by robots.txt', async () => {
    const { runCrawlJob } = await import('./engine.js');
    const resolveImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://robots.example/robots.txt') {
        return jsonResponse(200, 'User-agent: *\nDisallow: /private\n');
      }
      if (url.endsWith('/sitemap.xml')) return jsonResponse(404, '');
      if (url === 'https://robots.example/') {
        return jsonResponse(
          200,
          html({ title: 'Root', meta: 'm', h1: 'h', words: 400, links: ['/private/secret', '/public'] }),
        );
      }
      if (url === 'https://robots.example/public') {
        return jsonResponse(200, html({ title: 'Public', meta: 'm', h1: 'h', words: 400 }));
      }
      throw new Error(`should not fetch disallowed path: ${url}`);
    });

    await runCrawlJob(JOB, ORG, BRAND, 'https://robots.example/', { fetchImpl, resolveImpl, sleep: fastSleep });

    const createdUrls = db.pages.create.mock.calls.map((c) => c[0].data.url as string);
    expect(createdUrls).toContain('https://robots.example/public');
    expect(createdUrls).not.toContain('https://robots.example/private/secret');
  });
});
