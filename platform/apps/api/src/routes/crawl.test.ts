import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  crawl_jobs: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  // writeAuditEvent runs org-attributed writes inside withOrgContext now
  // (see lib/audit.ts), so the transaction client exposes audit_events.
  audit_events: db.audit_events,
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

// The route schedules the real crawl via setImmediate — mocked out here so
// route tests assert ONLY the pre-fetch invariant (the DB row exists in
// `queued` status before any HTTP request), not the crawl itself (covered
// by crawler/engine.test.ts).
const runCrawlJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/crawler/engine.js', () => ({ runCrawlJob }));

async function buildApp() {
  const { default: crawl } = await import('./crawl.js');
  const app = new Hono();
  app.route('/crawl', crawl);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', website_url: 'https://acme.example' };

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.crawl_jobs.findFirst.mockResolvedValue(null);
});

describe('POST /brands/me/crawl', () => {
  it('403s for a viewer (below create_brand_profile)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('404s when the org has no brand profile', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('422s when the brand has no website_url set', async () => {
    db.brands.findFirst.mockResolvedValue({ ...BRAND, website_url: null });
    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('409s when a crawl is already queued or running for this brand', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'existing-job' });
    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.crawlJobId).toBe('existing-job');
  });

  it('creates a queued crawl_jobs row BEFORE scheduling the background crawl, writes an audit event, and returns 202', async () => {
    const callOrder: string[] = [];
    db.crawl_jobs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push('db.create');
      return { id: 'job-1', ...data, pages_crawled: 0, pages_found: 0, pages_failed: 0, error: null, started_at: null, completed_at: null, created_at: new Date() };
    });
    runCrawlJob.mockImplementation(async () => {
      callOrder.push('runCrawlJob');
    });

    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'job-1', status: 'queued', rootUrl: 'https://acme.example' });

    expect(db.crawl_jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          brand_id: 'brand-1',
          root_url: 'https://acme.example',
          status: 'queued',
          created_by: 'user-1',
        }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'crawl_job.created' }) }),
    );

    // Give the fire-and-forget setImmediate callback a turn to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runCrawlJob).toHaveBeenCalledWith('job-1', 'org-1', 'brand-1', 'https://acme.example');

    // The literal invariant: the DB row was created before the background
    // job (and therefore before any HTTP request) ever ran.
    expect(callOrder).toEqual(['db.create', 'runCrawlJob']);
  });

  it('marks the job failed if the background crawl throws unexpectedly', async () => {
    db.crawl_jobs.create.mockResolvedValue({
      id: 'job-2',
      organization_id: 'org-1',
      brand_id: 'brand-1',
      root_url: 'https://acme.example',
      status: 'queued',
      pages_crawled: 0,
      pages_found: 0,
      pages_failed: 0,
      error: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
    });
    runCrawlJob.mockRejectedValue(new Error('boom'));

    const app = await buildApp();
    const res = await app.request('/crawl', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(202);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.crawl_jobs.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-2' },
        data: expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') }),
      }),
    );
  });
});
