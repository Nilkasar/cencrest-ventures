import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === undefined ? true : row[key] === value));
}

let actRows: Array<Record<string, unknown>> = [];
let measurementRows: Array<Record<string, unknown>> = [];

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  actions: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = actRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
  },
  measurements: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const matching = measurementRows.filter((r) => matches(r, where));
      if (matching.length === 0) return null;
      // orderBy measured_at desc — the route's own contract.
      return [...matching].sort((a, b) => (b.measured_at as Date).getTime() - (a.measured_at as Date).getTime())[0]!;
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
  const { default: actionMeasurement } = await import('./action-measurement.js');
  const app = new Hono();
  app.route('/actions', actionMeasurement);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function makeAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'action-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    status: 'completed',
    executed_at: new Date('2026-01-10T00:00:00.000Z'),
    before_score_captured_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    ...overrides,
  };
}

function makeMeasurement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'measurement-1',
    organization_id: 'org-1',
    action_id: 'action-1',
    brand_id: 'brand-1',
    before_score: { geo: { aiVisibilityScore: 40 }, seo: null, capturedAt: '2026-01-01T00:00:00.000Z' },
    before_score_captured_at: new Date('2026-01-01T00:00:00.000Z'),
    after_score: { geo: { aiVisibilityScore: 55 }, seo: null, capturedAt: '2026-01-29T00:00:00.000Z' },
    after_ai_run_id: 'run-after',
    score_delta: '15.00',
    attribution_confidence: 'high',
    attribution_notes: 'The AI-visibility score improved by 15.00 points — an estimate, not proof of causation.',
    measured_at: new Date('2026-01-29T00:00:00.000Z'),
    created_at: new Date('2026-01-29T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  actRows = [];
  measurementRows = [];

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
});

describe('GET /actions/:id/measurement', () => {
  it('404s (not a leaking 403) for an action belonging to a different organization — tenant isolation', async () => {
    actRows = [makeAction()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/measurement', { headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  it('404s for an unknown action id', async () => {
    const app = await buildApp();
    const res = await app.request('/actions/does-not-exist/measurement', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('returns measured: false with the action\'s own status when no measurement exists yet — always 200, same "poll like run status" precedent as GET /ai-runs/:id/score', async () => {
    actRows = [makeAction()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/measurement', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { measured: boolean; action: { id: string; status: string } };
    expect(body.measured).toBe(false);
    expect(body.action.id).toBe('action-1');
    expect(body.action.status).toBe('completed');
  });

  it('returns measured: true with the full before/after comparison once one exists', async () => {
    actRows = [makeAction()];
    measurementRows = [makeMeasurement()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/measurement', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      measured: boolean;
      measurement: { id: string; scoreDelta: number; attributionConfidence: string; attributionNotes: string };
    };
    expect(body.measured).toBe(true);
    expect(body.measurement.id).toBe('measurement-1');
    expect(body.measurement.scoreDelta).toBe(15);
    expect(body.measurement.attributionConfidence).toBe('high');
    // Attribution language never asserts certainty (non-negotiable #4) —
    // even in the raw API response text.
    expect(body.measurement.attributionNotes).not.toMatch(/\bconfirmed\b|\bproven\b/i);
  });

  it('returns the MOST RECENT measurement when more than one exists for the same action', async () => {
    actRows = [makeAction()];
    measurementRows = [
      makeMeasurement({ id: 'measurement-old', measured_at: new Date('2026-01-15T00:00:00.000Z'), score_delta: '5.00' }),
      makeMeasurement({ id: 'measurement-new', measured_at: new Date('2026-02-15T00:00:00.000Z'), score_delta: '20.00' }),
    ];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/measurement', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { measurement: { id: string } };
    expect(body.measurement.id).toBe('measurement-new');
  });

  it('a viewer can read a measurement (view_intelligence, read-only)', async () => {
    actRows = [makeAction()];
    measurementRows = [makeMeasurement()];
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/measurement', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });
});
