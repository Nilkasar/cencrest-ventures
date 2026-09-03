import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  measurements: { findMany: vi.fn(), count: vi.fn() },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  measurements: db.measurements,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: measurements } = await import('./measurements.js');
  const app = new Hono();
  app.route('/brands/me/measurements', measurements);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };

const MEASUREMENT_ROW = {
  id: 'measurement-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  action_id: 'action-1',
  before_score: { geo: { aiVisibilityScore: 40 }, seo: null, capturedAt: '2026-01-01T00:00:00.000Z' },
  before_score_captured_at: new Date('2026-01-01T00:00:00.000Z'),
  after_score: { geo: { aiVisibilityScore: 55 }, seo: null, capturedAt: '2026-01-29T00:00:00.000Z' },
  after_ai_run_id: 'run-after',
  score_delta: '15.00',
  attribution_confidence: 'high',
  attribution_notes: 'The AI-visibility score improved by 15.00 points — an estimate, not proof of causation.',
  measured_at: new Date('2026-01-29T00:00:00.000Z'),
  created_at: new Date('2026-01-29T00:00:00.000Z'),
};

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.measurements.findMany.mockResolvedValue([MEASUREMENT_ROW]);
  db.measurements.count.mockResolvedValue(1);
});

describe('GET /brands/me/measurements', () => {
  it('401s with no auth token at all', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/measurements');
    expect(res.status).toBe(401);
  });

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/measurements', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('a viewer can list measurements (view_intelligence, read-only)', async () => {
    const app = await buildApp();
    const res = await app.request('/brands/me/measurements', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; scoreDelta: number; attributionConfidence: string }>; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe('measurement-1');
    expect(body.items[0]!.scoreDelta).toBe(15);
    expect(body.items[0]!.attributionConfidence).toBe('high');
    expect(body.total).toBe(1);
  });

  it('sorts by measured_at desc — asserted directly on the query', async () => {
    const app = await buildApp();
    await app.request('/brands/me/measurements', { headers: await authHeader('user-1', 'org-1') });
    expect(db.measurements.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { measured_at: 'desc' } }));
  });

  it('scopes strictly by this org/brand — tenant isolation asserted directly on the query', async () => {
    const app = await buildApp();
    await app.request('/brands/me/measurements', { headers: await authHeader('user-1', 'org-1') });
    expect(db.measurements.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: 'org-1', brand_id: 'brand-1' } }),
    );
  });

  it('paginates via limit/offset query params', async () => {
    const app = await buildApp();
    await app.request('/brands/me/measurements?limit=5&offset=10', { headers: await authHeader('user-1', 'org-1') });
    expect(db.measurements.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
  });
});
