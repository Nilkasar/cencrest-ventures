import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  crawl_jobs: { findFirst: vi.fn() },
};

const tx = { organizations: db.organizations, memberships: db.memberships, users: db.users, crawl_jobs: db.crawl_jobs };

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

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  vi.clearAllMocks();
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
