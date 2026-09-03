import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  reports: { findMany: vi.fn(), count: vi.fn() },
};
const tx = { ...db };
vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

// This route's own HTTP-level concerns (auth, brand resolution, Zod
// validation, permission gating, response shape) are what this file tests
// — the real content-assembly logic (`generateReport`) is covered in full
// by `lib/reporting/generate-report.test.ts`, same "mock the dependency,
// assert the call" split `routes/agents.test.ts` already uses for
// `triggerAgentRun`.
const generateReport = vi.fn();
vi.mock('../lib/reporting/generate-report.js', () => ({ generateReport: (...args: unknown[]) => generateReport(...args) }));

const notifyForGeneratedReport = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/reporting/notify-for-report.js', () => ({ notifyForGeneratedReport: (...args: unknown[]) => notifyForGeneratedReport(...args) }));

async function buildApp() {
  const { createReportsRoutes } = await import('./reports.js');
  const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };
  const app = new Hono();
  app.route('/brands/me/reports', createReportsRoutes(emailSender));
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };

const REPORT_ROW = {
  id: 'report-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  name: 'Weekly Digest (2026-01-01 – 2026-01-08)',
  type: 'weekly',
  format: 'json',
  status: 'completed',
  file_path: null,
  metadata: null,
  period_start: new Date('2026-01-01T00:00:00.000Z'),
  period_end: new Date('2026-01-08T00:00:00.000Z'),
  generated_at: new Date('2026-01-08T00:00:00.000Z'),
  content: { reportType: 'weekly', scoreDeltas: [], newOpportunities: [], competitorMovements: [] },
  created_by: 'user-1',
  created_at: new Date('2026-01-08T00:00:00.000Z'),
  completed_at: new Date('2026-01-08T00:00:00.000Z'),
};

beforeEach(async () => {
  vi.clearAllMocks();
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.reports.findMany.mockResolvedValue([REPORT_ROW]);
  db.reports.count.mockResolvedValue(1);
  generateReport.mockResolvedValue(REPORT_ROW);
});

describe('GET /brands/me/reports', () => {
  it('401s with no auth token', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports');
    expect(res.status).toBe(401);
  });

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/reports', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('lists reports as SUMMARIES — content is omitted from the list response', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe('report-1');
    expect(body.items[0]!.content).toBeUndefined();
    expect(body.total).toBe(1);
  });

  it('filters by type, scoped strictly to this org/brand', async () => {
    const app = await buildApp();
    await app.request('/brands/me/reports?type=weekly', { headers: await authHeader('user-1', 'org-1') });
    expect(db.reports.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: 'org-1', brand_id: 'brand-1', type: 'weekly' } }),
    );
  });

  it('rejects an invalid type filter', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports?type=nonsense', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('a viewer can list reports (view_intelligence, read-only)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/brands/me/reports', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });
});

describe('POST /brands/me/reports/generate', () => {
  it('generates a report and notifies via the shared notify() mechanism', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'weekly' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { report: { id: string; content: unknown } };
    expect(body.report.id).toBe('report-1');
    // Detail response (unlike list) DOES include the full content.
    expect(body.report.content).toBeDefined();

    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', brandId: 'brand-1', type: 'weekly', createdBy: 'user-1' }),
    );
    expect(notifyForGeneratedReport).toHaveBeenCalledWith(REPORT_ROW, expect.objectContaining({ emailSender: expect.anything() }));
  });

  it('requires periodStart/periodEnd for a custom report', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'custom' }),
    });
    expect(res.status).toBe(422);
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('accepts a custom report with an explicit period', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'custom', periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-15T00:00:00.000Z' }),
    });
    expect(res.status).toBe(201);
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ periodStart: new Date('2026-01-01T00:00:00.000Z'), periodEnd: new Date('2026-01-15T00:00:00.000Z') }),
    );
  });

  it('rejects an invalid report type', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'quarterly' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'weekly' }),
    });
    expect(res.status).toBe(404);
  });

  it('a viewer cannot generate a report (create_brand_profile requires analyst+)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/brands/me/reports/generate', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'weekly' }),
    });
    expect(res.status).toBe(403);
    expect(generateReport).not.toHaveBeenCalled();
  });
});
