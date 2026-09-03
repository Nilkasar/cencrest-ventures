import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === undefined ? true : row[key] === value));
}

let reportRows: Array<Record<string, unknown>> = [];

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  reports: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = reportRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
  },
};
const tx = { ...db };
vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: reportDetails } = await import('./report-details.js');
  const app = new Hono();
  app.route('/reports', reportDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function makeReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'report-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    name: 'Weekly Digest',
    type: 'weekly',
    format: 'json',
    status: 'completed',
    file_path: null,
    period_start: new Date('2026-01-01T00:00:00.000Z'),
    period_end: new Date('2026-01-08T00:00:00.000Z'),
    generated_at: new Date('2026-01-08T00:00:00.000Z'),
    content: { reportType: 'weekly', scoreDeltas: [{ id: 'measurement-1' }], newOpportunities: [], competitorMovements: [] },
    created_by: 'user-1',
    created_at: new Date('2026-01-08T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  reportRows = [];

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
});

describe('GET /reports/:id', () => {
  it('401s with no auth token', async () => {
    const app = await buildApp();
    const res = await app.request('/reports/report-1');
    expect(res.status).toBe(401);
  });

  it('404s (not a leaking 403) for a report belonging to a different organization — tenant isolation', async () => {
    reportRows = [makeReport()];
    const app = await buildApp();
    const res = await app.request('/reports/report-1', { headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  it('404s for an unknown report id', async () => {
    const app = await buildApp();
    const res = await app.request('/reports/does-not-exist', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('returns the full immutable content snapshot', async () => {
    reportRows = [makeReport()];
    const app = await buildApp();
    const res = await app.request('/reports/report-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: { id: string; content: { scoreDeltas: unknown[] } } };
    expect(body.report.id).toBe('report-1');
    expect(body.report.content.scoreDeltas).toHaveLength(1);
  });

  it('a viewer can read a report (view_intelligence, read-only)', async () => {
    reportRows = [makeReport()];
    const app = await buildApp();
    const res = await app.request('/reports/report-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });
});
