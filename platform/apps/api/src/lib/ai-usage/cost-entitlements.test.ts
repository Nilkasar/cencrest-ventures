import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CostBudgetExceededError as CostRefusal } from './cost-entitlements.js';

const db = {
  subscriptions: { findUnique: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** A stand-in estimate — the estimator has its own suite; these tests are
 * about the ceilings, so the projected number is supplied directly. */
function estimate(micros: bigint, unpricedModels: string[] = []) {
  return {
    micros,
    usd: '0.000000',
    totalCalls: 5600,
    lines: [],
    unpricedModels,
    profile: {
      geoTokensIn: 200,
      geoTokensOut: 800,
      extractionTokensIn: 1400,
      extractionTokensOut: 250,
      extractionAttempts: 1,
    },
    pricingTableVersion: '2026-09-25',
  };
}


/** Asserts the promise was REFUSED and hands back the typed error. A test
 * that expects a refusal must fail loudly if the run was allowed instead —
 * `.catch(e => e)` alone would type-widen and silently pass. */
async function catchRefusal(promise: Promise<unknown>): Promise<CostRefusal> {
  const { CostBudgetExceededError } = await import('./cost-entitlements.js');
  try {
    await promise;
  } catch (err) {
    if (err instanceof CostBudgetExceededError) return err;
    throw err;
  }
  throw new Error('expected the run to be refused on a cost ceiling, but it was allowed');
}

/** Pro seeds ai_cost_budget_usd_per_month: 1200, max_cost_per_run_usd: 300. */
function proPlan() {
  return { plan: 'pro' };
}

describe('parseUsdCeilingToMicros', () => {
  it('converts a seeded JSON number to exact micro-dollars with no float step', async () => {
    const { parseUsdCeilingToMicros } = await import('./cost-entitlements.js');
    expect(parseUsdCeilingToMicros(1200, 'test')).toBe(1_200_000_000n);
    expect(parseUsdCeilingToMicros(0.1, 'test')).toBe(100_000n);
  });

  it('accepts a decimal string, in case an admin surface ever writes one', async () => {
    const { parseUsdCeilingToMicros } = await import('./cost-entitlements.js');
    expect(parseUsdCeilingToMicros('12.500000', 'test')).toBe(12_500_000n);
  });

  it('null means no ceiling configured', async () => {
    const { parseUsdCeilingToMicros } = await import('./cost-entitlements.js');
    expect(parseUsdCeilingToMicros(null, 'test')).toBeNull();
    expect(parseUsdCeilingToMicros(undefined, 'test')).toBeNull();
  });

  it('a malformed ceiling is logged loudly and treated as unconfigured, not as a 500 on every run', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { parseUsdCeilingToMicros } = await import('./cost-entitlements.js');
    expect(parseUsdCeilingToMicros('six hundred', 'plan=pro')).toBeNull();
    expect(parseUsdCeilingToMicros(-5, 'plan=pro')).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('checkAiRunCostBudget', () => {
  it('ALLOWS a run that fits, and reports the remaining budget', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    // Pro: $1,200/month, $300/run. $120 already spent, this run projects $80.
    const preflight = await checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(80_000_000n),
      sumSpend: async () => 120_000_000n,
    });

    expect(preflight.checked).toBe(true);
    expect(preflight.organizationId).toBe('org-1');
    expect(preflight.plan).toBe('pro');
    expect(preflight.projectedUsd).toBe('80.000000');
    expect(preflight.monthlyBudgetMicros).toBe(1_200_000_000n);
    expect(preflight.remainingMicros).toBe(1_080_000_000n);
  });

  it('REFUSES a run that would breach the MONTHLY ceiling, naming projected and remaining', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget, costRefusalBody } = await import('./cost-entitlements.js');

    // $1,160 spent of $1,200; this run projects $80 -> 1160 + 80 > 1200.
    const promise = checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(80_000_000n),
      sumSpend: async () => 1_160_000_000n,
    });

    const err = await catchRefusal(promise);
    expect(err.ceiling).toBe('ai_cost_budget_usd_per_month');
    expect(err.projectedUsd).toBe('80.000000');
    expect(err.currentUsd).toBe('1160.000000');
    expect(err.remainingUsd).toBe('40.000000');
    expect(err.upgradeTo).toBe('agency');

    const body = costRefusalBody(err);
    expect(body.error).toBe('ai_cost_budget_exceeded');
    expect(body.remaining_usd).toBe('40.000000');
    expect(body.projected_usd).toBe('80.000000');
  });

  it('REFUSES a single mis-sized run on the PER-RUN ceiling even with a clean month', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    const promise = checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(301_000_000n), // $301 > Pro's $300 per-run ceiling
      sumSpend: async () => 0n,
    });

    const err = await catchRefusal(promise);
    expect(err.ceiling).toBe('max_cost_per_run_usd');
    expect(err.limitUsd).toBe('300.000000');
    // The monthly figure is not consulted for a per-run refusal.
    expect(err.currentUsd).toBe('0.000000');
  });

  it('the per-run ceiling is checked FIRST, so the error names the thing the customer can act on', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    // Breaches BOTH: $400 projected (> $300/run) with $1,100 already spent.
    const err = await catchRefusal(checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(400_000_000n),
      sumSpend: async () => 1_100_000_000n,
    }));

    expect(err.ceiling).toBe('max_cost_per_run_usd');
  });

  it('an exactly-at-the-limit monthly total is allowed; one micro-dollar more is not', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    await expect(
      checkAiRunCostBudget({
        organizationId: 'org-1',
        estimate: estimate(100_000_000n),
        sumSpend: async () => 1_100_000_000n,
      }),
    ).resolves.toMatchObject({ remainingMicros: 100_000_000n });

    await expect(
      checkAiRunCostBudget({
        organizationId: 'org-1',
        estimate: estimate(100_000_001n),
        sumSpend: async () => 1_100_000_000n,
      }),
    ).rejects.toThrow(/ai_cost_budget_usd_per_month/);
  });

  it('an org already over budget sees $0 remaining, never a negative number', async () => {
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    const err = await catchRefusal(checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(1_000_000n),
      sumSpend: async () => 1_400_000_000n,
    }));

    expect(err.remainingUsd).toBe('0.000000');
  });

  it('REFUSES a run whose estimate contains an unpriced model — the projection is a known under-count', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.subscriptions.findUnique.mockResolvedValue(proPlan());
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    await catchRefusal(
      checkAiRunCostBudget({
        organizationId: 'org-1',
        estimate: estimate(0n, ['some-unreleased-model-9']),
        sumSpend: async () => 0n,
      }),
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an unlimited tier (no ceilings) allows anything and never queries spend at all', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'enterprise' });
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');
    const sumSpend = vi.fn();

    const preflight = await checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(50_000_000_000n),
      sumSpend,
    });

    expect(preflight.monthlyBudgetMicros).toBeNull();
    expect(preflight.remainingMicros).toBeNull();
    expect(sumSpend).not.toHaveBeenCalled();
  });

  it('an org with no subscription row fails toward the FREE tier ceilings, not toward unlimited', async () => {
    db.subscriptions.findUnique.mockResolvedValue(null);
    const { checkAiRunCostBudget } = await import('./cost-entitlements.js');

    // free: $15/month, $6/run.
    const err = await catchRefusal(checkAiRunCostBudget({
      organizationId: 'org-1',
      estimate: estimate(7_000_000n),
      sumSpend: async () => 0n,
    }));

    expect(err.plan).toBe('free');
    expect(err.ceiling).toBe('max_cost_per_run_usd');
    expect(err.limitUsd).toBe('6.000000');
  });
});
