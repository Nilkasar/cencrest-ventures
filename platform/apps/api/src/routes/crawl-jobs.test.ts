import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  crawl_jobs: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  crawl_jobs: db.crawl_jobs,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: crawlJobs } = await import('./crawl-jobs.js');
  const app = new Hono();
  app.route('/crawl-jobs', crawlJobs);
  return app;
}

async function buildListApp() {
  const { crawlJobsListRoute } = await import('./crawl-jobs.js');
  const app = new Hono();
  app.route('/brands/me/crawl-jobs', crawlJobsListRoute);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
});

describe('GET /crawl-jobs/:id', () => {
  it('404s for a job that does not exist (or belongs to another org — tenant isolation)', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/crawl-jobs/nope', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    // The lookup itself is always scoped by organization_id — see
    // routes/crawl-jobs.ts.
    expect(db.crawl_jobs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'nope', organization_id: 'org-1' } }),
    );
  });

  it('a viewer can read status (view_intelligence is viewer+)', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({
      id: 'job-1',
      brand_id: 'brand-1',
      root_url: 'https://acme.example',
      status: 'running',
      pages_crawled: 10,
      pages_found: 40,
      pages_failed: 1,
      error: null,
      started_at: new Date('2026-01-01'),
      completed_at: null,
      created_at: new Date('2026-01-01'),
    });
    const app = await buildApp();
    const res = await app.request('/crawl-jobs/job-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'job-1', status: 'running', pagesCrawled: 10, pagesFound: 40, progressPct: 25 });
  });

  it('reports 100% progress once completed even if pagesFound undercounted', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({
      id: 'job-2',
      brand_id: 'brand-1',
      root_url: 'https://acme.example',
      status: 'completed',
      pages_crawled: 12,
      pages_found: 12,
      pages_failed: 0,
      error: null,
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    });
    const app = await buildApp();
    const res = await app.request('/crawl-jobs/job-2', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.progressPct).toBe(100);
  });
});

// Epic 19 (Production Hardening), item 5 — GET /brands/me/crawl-jobs, the
// gap Epic 3's own completion doc flagged (no server-side list route;
// apps/web's data/website/client.ts worked around it with a localStorage
// pointer list — see that file's header comment).
describe('GET /brands/me/crawl-jobs', () => {
  const BRAND = { id: 'brand-1', organization_id: 'org-1' };
  const JOB = {
    id: 'job-1',
    brand_id: 'brand-1',
    root_url: 'https://acme.example',
    status: 'completed',
    pages_crawled: 12,
    pages_found: 12,
    pages_failed: 0,
    error: null,
    started_at: new Date('2026-01-01'),
    completed_at: new Date('2026-01-01'),
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  };

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('returns a paginated, tenant-scoped, newest-first list', async () => {
    db.brands.findFirst.mockResolvedValue(BRAND);
    db.crawl_jobs.count.mockResolvedValue(1);
    db.crawl_jobs.findMany.mockResolvedValue([JOB]);

    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { crawlJobs: Array<Record<string, unknown>>; pagination: Record<string, number> };
    expect(body.crawlJobs).toHaveLength(1);
    expect(body.crawlJobs[0]).toMatchObject({ id: 'job-1', status: 'completed', pagesCrawled: 12 });
    expect(body.pagination).toEqual({ total: 1, limit: 25, offset: 0 });

    expect(db.crawl_jobs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: 'org-1', brand_id: 'brand-1' },
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 25,
      }),
    );
  });

  it('filters by status when given', async () => {
    db.brands.findFirst.mockResolvedValue(BRAND);
    db.crawl_jobs.count.mockResolvedValue(0);
    db.crawl_jobs.findMany.mockResolvedValue([]);

    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs?status=running', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);

    expect(db.crawl_jobs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: 'org-1', brand_id: 'brand-1', status: 'running' } }),
    );
  });

  it('422s on an invalid status value', async () => {
    db.brands.findFirst.mockResolvedValue(BRAND);
    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs?status=bogus', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('clamps limit to the server-side cap of 100 — a caller cannot request more (Epic 19 item 6, pagination audit)', async () => {
    db.brands.findFirst.mockResolvedValue(BRAND);
    db.crawl_jobs.count.mockResolvedValue(0);
    db.crawl_jobs.findMany.mockResolvedValue([]);

    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs?limit=99999', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422); // z.number().max(100) rejects rather than silently clamping — same convention pages.ts's listQuerySchema uses

    const okRes = await app.request('/brands/me/crawl-jobs?limit=100', { headers: await authHeader('user-1', 'org-1') });
    expect(okRes.status).toBe(200);
    expect(db.crawl_jobs.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('a viewer can list (view_intelligence is viewer+)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    db.brands.findFirst.mockResolvedValue(BRAND);
    db.crawl_jobs.count.mockResolvedValue(0);
    db.crawl_jobs.findMany.mockResolvedValue([]);

    const app = await buildListApp();
    const res = await app.request('/brands/me/crawl-jobs', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });

  it('never returns another organization\'s jobs — always scoped by organization_id in the WHERE clause', async () => {
    db.brands.findFirst.mockResolvedValue(BRAND);
    db.crawl_jobs.count.mockResolvedValue(0);
    db.crawl_jobs.findMany.mockResolvedValue([]);

    const app = await buildListApp();
    await app.request('/brands/me/crawl-jobs', { headers: await authHeader('user-1', 'org-1') });

    expect(db.crawl_jobs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-1' }) }),
    );
  });
});
