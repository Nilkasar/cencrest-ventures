import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const db = {
  plans: { findMany: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

async function buildApp() {
  const { default: plans } = await import('./plans.js');
  const app = new Hono();
  app.route('/plans', plans);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /plans — public, no auth required', () => {
  it('returns the seeded plans, sorted low-to-high tier, when the plans table has rows', async () => {
    db.plans.findMany.mockResolvedValue([
      { slug: 'growth', name: 'Growth', description: 'd', price_monthly: null, price_yearly: null, limits: { competitors_tracked: 10 }, features: {}, active: true },
      { slug: 'free', name: 'Free', description: 'd', price_monthly: null, price_yearly: null, limits: { competitors_tracked: 2 }, features: {}, active: true },
    ]);
    const app = await buildApp();
    const res = await app.request('/plans');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body.map((p) => p.slug)).toEqual(['free', 'growth']);
  });

  it('never requires an Authorization header (no requireAuth on this route)', async () => {
    db.plans.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/plans');
    expect(res.status).toBe(200);
  });

  it('falls back to the exact seed catalog (all 7 tiers) when the plans table is empty', async () => {
    db.plans.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.request('/plans');
    const body = (await res.json()) as Array<{ slug: string; limits: { competitors_tracked: number | null } }>;
    expect(body).toHaveLength(7);
    expect(body.map((p) => p.slug)).toEqual([
      'free',
      'starter',
      'growth',
      'pro',
      'agency',
      'managed',
      'enterprise',
    ]);
    // Load-bearing regression value, transcribed identically into the
    // fallback catalog — see entitlements.test.ts for the same number.
    expect(body.find((p) => p.slug === 'free')?.limits.competitors_tracked).toBe(2);
  });
});
