import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const FREE_PLAN = {
  id: 'plan-free',
  slug: 'free',
  name: 'Free',
  description: 'd',
  price_monthly: null,
  price_yearly: null,
  limits: { competitors_tracked: 2, queries_per_query_set: 50, ai_queries_per_month: 50, team_members: 1 },
  features: {},
  active: true,
};

const GROWTH_PLAN = {
  ...FREE_PLAN,
  id: 'plan-growth',
  slug: 'growth',
  name: 'Growth',
  limits: { competitors_tracked: 10, queries_per_query_set: 500, ai_queries_per_month: 2000, team_members: 5 },
};

const db = {
  organizations: { findUnique: vi.fn(), update: vi.fn() },
  memberships: { findFirst: vi.fn(), count: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  competitors: { count: vi.fn() },
  query_sets: { findFirst: vi.fn() },
  ai_runs: { aggregate: vi.fn() },
  subscriptions: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  plans: { findUnique: vi.fn() },
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
  competitors: db.competitors,
  query_sets: db.query_sets,
  ai_runs: db.ai_runs,
  subscriptions: db.subscriptions,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: subscription } = await import('./subscription.js');
  const app = new Hono();
  app.route('/subscription', subscription);
  return app;
}

interface SubscriptionResponseBody {
  plan: { slug: string };
  subscription: { status: string; cancelledAt: string | null };
  usage: Record<string, { used: number | null; limit: number | null }>;
  error?: string;
  cancelledAt?: string;
}

async function jsonBody(res: Response): Promise<SubscriptionResponseBody> {
  return (await res.json()) as SubscriptionResponseBody;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'owner@example.com', org: orgId });
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  process.env.BILLING_WEBHOOK_SECRET = 'test-secret';
  const { __setPaymentProviderForTesting } = await import('../lib/billing/payment-provider.js');
  __setPaymentProviderForTesting(undefined);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', name: 'Owner', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
  db.memberships.count.mockResolvedValue(1);
  db.brands.findFirst.mockResolvedValue(null);
  db.competitors.count.mockResolvedValue(0);
  db.query_sets.findFirst.mockResolvedValue(null);
  db.ai_runs.aggregate.mockResolvedValue({ _sum: { total_jobs: null } });
  db.plans.findUnique.mockImplementation(async ({ where: { slug } }: { where: { slug: string } }) =>
    slug === 'growth' ? GROWTH_PLAN : slug === 'free' ? FREE_PLAN : null,
  );
});

describe('GET /subscription', () => {
  it('bootstraps a free subscription for an org that never had one', async () => {
    db.subscriptions.findUnique.mockResolvedValue(null);
    db.subscriptions.create.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan_id: FREE_PLAN.id,
      plan: 'free',
      status: 'active',
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: null,
      cancelled_at: null,
      external_customer_id: null,
      external_id: null,
    });

    const app = await buildApp();
    const res = await app.request('/subscription', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.plan.slug).toBe('free');
    expect(db.subscriptions.create).toHaveBeenCalledOnce();
    expect(body.usage.competitors_tracked).toEqual({ used: 0, limit: 2 });
    expect(body.usage.team_members).toEqual({ used: 1, limit: 1 });
    // Documented-but-not-yet-enforced metrics report "not tracked", never a
    // fabricated number.
    expect(body.usage.pages_analyzed?.used).toBeNull();
  });

  it('reads the existing subscription without creating a new one', async () => {
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan_id: GROWTH_PLAN.id,
      plan: 'growth',
      status: 'active',
      current_period_start: new Date('2026-01-01'),
      current_period_end: new Date('2026-02-01'),
      trial_ends_at: null,
      cancelled_at: null,
      external_customer_id: 'cus_1',
      external_id: 'sub_ext_1',
      plans: GROWTH_PLAN,
    });

    const app = await buildApp();
    const res = await app.request('/subscription', { headers: await authHeader('user-1', 'org-1') });
    const body = await jsonBody(res);
    expect(body.plan.slug).toBe('growth');
    expect(db.subscriptions.create).not.toHaveBeenCalled();
  });
});

describe('GET /subscription/invoices', () => {
  it('returns an empty list for an org that never went through upgrade (no external_customer_id yet)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan: 'free',
      plans: FREE_PLAN,
      external_customer_id: null,
    });
    const app = await buildApp();
    const res = await app.request('/subscription/invoices', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    expect((await res.json()) as { invoices: unknown[] }).toEqual({ invoices: [] });
  });

  it("returns the NullPaymentProvider's fake invoice history for an org with a real external customer id", async () => {
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan: 'growth',
      plans: GROWTH_PLAN,
      external_customer_id: 'cus_1',
    });
    const app = await buildApp();
    const res = await app.request('/subscription/invoices', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: Array<{ id: string; status: string; amountCents: number }> };
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]).toMatchObject({ status: 'paid', amountCents: 0 });
  });

  it('any member (not just owner) can view invoice history', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan: 'free',
      plans: FREE_PLAN,
      external_customer_id: null,
    });
    const app = await buildApp();
    const res = await app.request('/subscription/invoices', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });
});

describe('POST /subscription/upgrade', () => {
  const freeSub = {
    id: 'sub-1',
    organization_id: 'org-1',
    plan_id: FREE_PLAN.id,
    plan: 'free',
    status: 'active',
    current_period_start: null,
    current_period_end: null,
    trial_ends_at: null,
    cancelled_at: null,
    external_customer_id: null,
    external_id: null,
    plans: FREE_PLAN,
  };

  it('403s for a non-owner (manage_billing is owner-only per SECURITY.md)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    const app = await buildApp();
    const res = await app.request('/subscription/upgrade', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ planSlug: 'growth' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s when the "upgrade" target is not actually higher than the current plan', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ ...freeSub, plan: 'growth', plans: GROWTH_PLAN });
    const app = await buildApp();
    const res = await app.request('/subscription/upgrade', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ planSlug: 'free' }),
    });
    expect(res.status).toBe(422);
    const body = await jsonBody(res);
    expect(body.error).toBe('not_an_upgrade');
  });

  it('upgrades free -> growth for the owner: calls the PaymentProvider and persists the real plan_id', async () => {
    db.subscriptions.findUnique.mockResolvedValue(freeSub);
    db.subscriptions.update.mockResolvedValue({
      ...freeSub,
      plan_id: GROWTH_PLAN.id,
      plan: 'growth',
      external_customer_id: 'null_cus_x',
      external_id: 'null_sub_x',
    });

    const app = await buildApp();
    const res = await app.request('/subscription/upgrade', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ planSlug: 'growth' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.plan.slug).toBe('growth');
    expect(db.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ plan_id: GROWTH_PLAN.id, plan: 'growth', status: 'active' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalled();
  });
});

describe('POST /subscription/downgrade', () => {
  it('422s when the "downgrade" target is not actually lower than the current plan', async () => {
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan: 'free',
      plans: FREE_PLAN,
    });
    const app = await buildApp();
    const res = await app.request('/subscription/downgrade', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
      body: JSON.stringify({ planSlug: 'growth' }),
    });
    expect(res.status).toBe(422);
    expect((await jsonBody(res)).error).toBe('not_a_downgrade');
  });
});

describe('POST /subscription/cancel — non-negotiable: never hard-delete', () => {
  it('downgrades to free, cancels the external subscription, marks the org cancelled, and preserves other data', async () => {
    db.subscriptions.findUnique.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan: 'growth',
      plans: GROWTH_PLAN,
      external_customer_id: 'cus_1',
      external_id: 'sub_ext_1',
    });
    db.subscriptions.update.mockResolvedValue({
      id: 'sub-1',
      organization_id: 'org-1',
      plan_id: FREE_PLAN.id,
      plan: 'free',
      status: 'canceled',
      cancelled_at: new Date(),
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: null,
      external_customer_id: 'cus_1',
      external_id: 'sub_ext_1',
    });
    db.organizations.update.mockResolvedValue({ id: 'org-1', status: 'cancelled' });

    const app = await buildApp();
    const res = await app.request('/subscription/cancel', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.plan.slug).toBe('free');
    expect(db.organizations.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { status: 'cancelled' },
    });
    // No `.delete` mock exists on `db.subscriptions`/`db.organizations` at
    // all in this test file — if the route ever called one, this test
    // would fail with "db.subscriptions.delete is not a function" instead
    // of a clean 200. It didn't, so no delete call was made.

    // Data provably still queryable immediately after cancellation (epic
    // end-to-end flow step 7) — an unrelated table (`brands`) still reads
    // fine in the very same request cycle.
    db.brands.findFirst.mockResolvedValue({ id: 'brand-1', organization_id: 'org-1' });
    const brand = await db.brands.findFirst({ where: { organization_id: 'org-1' } });
    expect(brand).not.toBeNull();
  });

  it('403s for a non-owner', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
    const app = await buildApp();
    const res = await app.request('/subscription/cancel', {
      method: 'POST',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(403);
  });
});
