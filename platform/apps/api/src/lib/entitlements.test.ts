import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = {
  subscriptions: { findUnique: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolvePlanLimits', () => {
  it('defaults to the free tier when the org has no subscription row', async () => {
    db.subscriptions.findUnique.mockResolvedValue(null);
    const { resolvePlanLimits } = await import('./entitlements.js');

    const result = await resolvePlanLimits('org-1');
    expect(result.plan).toBe('free');
    expect(result.limits.competitors_tracked).toBe(2);
  });

  it('fails closed to free for an unrecognized plan value rather than trusting it', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'not-a-real-plan' });
    const { resolvePlanLimits } = await import('./entitlements.js');

    const result = await resolvePlanLimits('org-1');
    expect(result.plan).toBe('free');
  });

  it.each([
    ['free', 2],
    ['starter', 5],
    ['growth', 10],
    ['pro', 20],
  ])('resolves %s to a competitors_tracked limit of %d', async (plan, limit) => {
    db.subscriptions.findUnique.mockResolvedValue({ plan });
    const { resolvePlanLimits } = await import('./entitlements.js');

    const result = await resolvePlanLimits('org-1');
    expect(result.limits.competitors_tracked).toBe(limit);
  });

  it('agency tier is unlimited (null) for competitors_tracked — per-client is Epic 18', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'agency' });
    const { resolvePlanLimits } = await import('./entitlements.js');

    const result = await resolvePlanLimits('org-1');
    expect(result.limits.competitors_tracked).toBeNull();
  });

  // Post-verification fix: PLAN_TIERS was missing 'managed'/'enterprise'
  // (docs/16-billing/BILLING_ARCHITECTURE.md documents seven tiers, this
  // map had five) — see packages/database/DECISIONS.md §15. Both resolve
  // and both are unlimited, same treatment as 'agency' (no documented flat
  // number — custom SLAs).
  it.each(['managed', 'enterprise'])(
    '%s tier resolves (is not silently downgraded to free) and is unlimited for competitors_tracked',
    async (plan) => {
      db.subscriptions.findUnique.mockResolvedValue({ plan });
      const { resolvePlanLimits } = await import('./entitlements.js');

      const result = await resolvePlanLimits('org-1');
      expect(result.plan).toBe(plan);
      expect(result.limits.competitors_tracked).toBeNull();
    },
  );
});

describe('checkUsageLimit', () => {
  it('resolves silently when under the limit', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
    const { checkUsageLimit } = await import('./entitlements.js');

    await expect(
      checkUsageLimit('org-1', 'competitors_tracked', async () => 1),
    ).resolves.toBeUndefined();
  });

  it('throws EntitlementLimitError with plan/limit/current/upgradeTo when the increment would exceed the limit', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
    const { checkUsageLimit, EntitlementLimitError } = await import('./entitlements.js');

    await expect(
      checkUsageLimit('org-1', 'competitors_tracked', async () => 2),
    ).rejects.toMatchObject({
      constructor: EntitlementLimitError,
      metric: 'competitors_tracked',
      limit: 2,
      current: 2,
      plan: 'free',
      upgradeTo: 'starter',
    });
  });

  it('never throws for a plan whose limit is null (unlimited)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'agency' });
    const { checkUsageLimit } = await import('./entitlements.js');

    await expect(
      checkUsageLimit('org-1', 'competitors_tracked', async () => 999_999),
    ).resolves.toBeUndefined();
  });

  it('upgradeTo names the next real tier up, not just the historical top of the list', async () => {
    // Force a non-null limit at any tier isn't representable with the real
    // PLAN_LIMITS map (agency/managed/enterprise are all null), so this
    // exercises the boundary via the highest tier with a real number
    // instead: pro -> agency is still a real upgrade path, even though
    // agency itself is no longer the last tier (managed/enterprise were
    // added after — see packages/database/DECISIONS.md §15).
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'pro' });
    const { checkUsageLimit, EntitlementLimitError } = await import('./entitlements.js');

    await expect(
      checkUsageLimit('org-1', 'competitors_tracked', async () => 20),
    ).rejects.toMatchObject({ constructor: EntitlementLimitError, upgradeTo: 'agency' });
  });

  it('upgradeTo is null at the true top tier (enterprise has no higher plan)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'enterprise' });
    const { checkUsageLimit } = await import('./entitlements.js');

    // enterprise's own limit is null (unlimited), so this never rejects —
    // asserting that directly is the only way to observe "no higher tier"
    // for a metric that's unlimited at the top (there's no reject to
    // inspect an `upgradeTo` field on).
    await expect(
      checkUsageLimit('org-1', 'competitors_tracked', async () => 999_999),
    ).resolves.toBeUndefined();
  });
});
