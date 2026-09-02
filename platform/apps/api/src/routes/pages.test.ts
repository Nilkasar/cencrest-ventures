import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  crawl_jobs: { findFirst: vi.fn() },
  pages: { count: vi.fn(), findMany: vi.fn() },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  crawl_jobs: db.crawl_jobs,
  pages: db.pages,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: pages } = await import('./pages.js');
  const app = new Hono();
  app.route('/pages', pages);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1' };
const LATEST_JOB = { id: 'job-2', brand_id: 'brand-1', organization_id: 'org-1', created_at: new Date('2026-02-01') };

const SAMPLE_PAGE = {
  id: 'page-1',
  crawl_job_id: 'job-2',
  url: 'https://acme.example/',
  title: 'Home',
  meta_description: 'desc',
  h1: 'Welcome',
  canonical_url: 'https://acme.example/',
  status_code: 200,
  word_count: 500,
  internal_links: 3,
  external_links: 1,
  schema_types: ['Organization'],
  crawled_at: new Date('2026-02-01'),
  page_issues: [{ id: 'issue-1', issue_type: 'missing_meta', severity: 'medium', detail: null }],
};

beforeEach(async () => {
  vi.clearAllMocks();
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.crawl_jobs.findFirst.mockResolvedValue(LATEST_JOB);
  db.pages.count.mockResolvedValue(1);
  db.pages.findMany.mockResolvedValue([SAMPLE_PAGE]);
});

describe('GET /brands/me/pages', () => {
  it('404s when the org has no brand profile', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/pages', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('defaults to the brand\'s most recent crawl job', async () => {
    const app = await buildApp();
    const res = await app.request('/pages', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.crawl_jobs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brand_id: 'brand-1', organization_id: 'org-1' }, orderBy: { created_at: 'desc' } }),
    );
    const body = (await res.json()) as { pages: Array<Record<string, unknown>>; pagination: unknown };
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]).toMatchObject({
      id: 'page-1',
      url: 'https://acme.example/',
      hasSchemaMarkup: true,
      issues: [{ id: 'issue-1', issueType: 'missing_meta', severity: 'medium', detail: null }],
    });
    expect(body.pagination).toEqual({ total: 1, limit: 25, offset: 0 });
  });

  it('returns an empty page (not a 404) for a brand with no crawl jobs yet', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/pages', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ pages: [], pagination: { total: 0, limit: 25, offset: 0 } });
  });

  it('404s when an explicit crawlJobId does not belong to this brand/org', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(null); // simulates "not found for this brand"
    const app = await buildApp();
    const res = await app.request(`/pages?crawlJobId=${crypto.randomUUID()}`, {
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(404);
  });

  it('filters by severity', async () => {
    const app = await buildApp();
    const res = await app.request('/pages?severity=high', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.pages.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ page_issues: { some: { severity: 'high' } } }),
      }),
    );
  });

  it('422s on an invalid severity value', async () => {
    const app = await buildApp();
    const res = await app.request('/pages?severity=critical', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('caps limit at 100 and rejects a limit above it', async () => {
    const app = await buildApp();
    const res = await app.request('/pages?limit=500', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('applies pagination params to the query', async () => {
    const app = await buildApp();
    const res = await app.request('/pages?limit=10&offset=20', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect(db.pages.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });
});
