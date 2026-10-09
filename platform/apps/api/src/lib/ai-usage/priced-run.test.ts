/**
 * The bridge between "priced" and "executed": what a dispatcher stamps on the
 * run row, and what execution refuses to do with it. Pure functions — no
 * database, no clock.
 */
import { describe, expect, it } from 'vitest';
import {
  assertRunWithinPricedSize,
  pricedRunColumns,
  RunNotPricedError,
  RunSizeExceedsPricedError,
} from './priced-run.js';
import type { RunCostPreflight } from './cost-entitlements.js';

function certificate(overrides: Partial<RunCostPreflight> = {}): RunCostPreflight {
  return {
    checked: true,
    organizationId: 'org-1',
    pricedQueryCount: 1400,
    plan: 'pro',
    projectedMicros: 84_000_000n,
    projectedUsd: '84.000000',
    monthToDateMicros: 0n,
    monthlyBudgetMicros: 1_200_000_000n,
    perRunCeilingMicros: 300_000_000n,
    remainingMicros: 1_200_000_000n,
    estimate: {
      micros: 84_000_000n,
      usd: '84.000000',
      totalCalls: 11_200,
      lines: [],
      unpricedModels: [],
      profile: {
        geoTokensIn: 200,
        geoTokensOut: 2000,
        extractionTokensIn: 2800,
        extractionTokensOut: 250,
        extractionAttempts: 1,
      },
      pricingTableVersion: '2026-09-25',
    },
    ...overrides,
  };
}

describe('pricedRunColumns', () => {
  it('carries the approved size, the exact projected micro-dollars, and the pricing table that produced them', () => {
    expect(pricedRunColumns(certificate())).toEqual({
      priced_query_count: 1400,
      projected_cost_micro_usd: 84_000_000n,
      cost_pricing_table_version: '2026-09-25',
    });
  });

  it('keeps micro-dollars exact — the projection stored is the one the ceiling was compared against', () => {
    const columns = pricedRunColumns(certificate({ projectedMicros: 1n }));
    expect(columns.projected_cost_micro_usd).toBe(1n);
    expect(typeof columns.projected_cost_micro_usd).toBe('bigint');
  });
});

describe('assertRunWithinPricedSize', () => {
  const priced = { id: 'run-1', priced_query_count: 10, projected_cost_micro_usd: 600_000n };

  it('allows the exact size that was priced', () => {
    expect(() => assertRunWithinPricedSize(priced, 10)).not.toThrow();
  });

  it('allows a set that SHRANK — strictly cheaper than what was approved', () => {
    expect(() => assertRunWithinPricedSize(priced, 3)).not.toThrow();
    expect(() => assertRunWithinPricedSize(priced, 0)).not.toThrow();
  });

  it('REFUSES a set that grew by even one query', () => {
    expect(() => assertRunWithinPricedSize(priced, 11)).toThrow(RunSizeExceedsPricedError);
  });

  it('REFUSES the 10-priced/1,400-executed case this guard exists for, and names both numbers plus the approved dollars', () => {
    try {
      assertRunWithinPricedSize(priced, 1400);
      throw new Error('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(RunSizeExceedsPricedError);
      const message = (err as Error).message;
      expect(message).toContain('priced for 10 queries');
      expect(message).toContain('now holds 1,400');
      // The approved figure is in the message because this text is what lands
      // in `ai_runs.error` and is the only explanation a human gets.
      expect(message).toContain('$0.600000');
    }
  });

  it('REFUSES a row with no recorded price — fail closed, never read as unlimited', () => {
    expect(() =>
      assertRunWithinPricedSize({ id: 'run-2', priced_query_count: null, projected_cost_micro_usd: null }, 1),
    ).toThrow(RunNotPricedError);
    // Even zero work is refused: the point is that no approval exists, not
    // that the work is small.
    expect(() =>
      assertRunWithinPricedSize({ id: 'run-2', priced_query_count: null, projected_cost_micro_usd: null }, 0),
    ).toThrow(RunNotPricedError);
  });

  it('a run priced for zero queries cannot execute any', () => {
    const zero = { id: 'run-3', priced_query_count: 0, projected_cost_micro_usd: 0n };
    expect(() => assertRunWithinPricedSize(zero, 0)).not.toThrow();
    expect(() => assertRunWithinPricedSize(zero, 1)).toThrow(RunSizeExceedsPricedError);
  });
});
