/**
 * The enqueue-side half of the cost valve: `scheduleAiVisibilityRun` cannot
 * be called without a `RunCostPreflight`, and will not queue a run on another
 * org's certificate.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RunCostPreflight } from '../ai-usage/cost-entitlements.js';

const enqueue = vi.fn();
vi.mock('../queue/default-job-queue.js', () => ({
  getDefaultJobQueue: () => ({ enqueue, register: vi.fn() }),
  jobsRunInSeparateWorker: () => true,
}));
vi.mock('../queue/register-in-process.js', () => ({ registerInProcessJobHandler: vi.fn() }));
vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn({ ai_runs: { update: vi.fn() } })),
}));
vi.mock('./pipeline.js', () => ({ runAiVisibilityRun: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function preflightFor(organizationId: string): RunCostPreflight {
  return {
    checked: true,
    organizationId,
    plan: 'pro',
    projectedMicros: 80_000_000n,
    projectedUsd: '80.000000',
    monthToDateMicros: 0n,
    monthlyBudgetMicros: 600_000_000n,
    perRunCeilingMicros: 300_000_000n,
    remainingMicros: 600_000_000n,
    estimate: {
      micros: 80_000_000n,
      usd: '80.000000',
      totalCalls: 11_200,
      lines: [],
      unpricedModels: [],
      profile: {
        geoTokensIn: 200,
        geoTokensOut: 800,
        extractionTokensIn: 1400,
        extractionTokensOut: 250,
        extractionAttempts: 1,
      },
      pricingTableVersion: '2026-09-25',
    },
  };
}

describe('scheduleAiVisibilityRun', () => {
  it('enqueues the run when handed a preflight certificate for the same org', async () => {
    const { scheduleAiVisibilityRun } = await import('./schedule-run.js');

    await scheduleAiVisibilityRun('run-1', 'org-1', 'brand-1', preflightFor('org-1'));

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ runId: 'run-1', organizationId: 'org-1', brandId: 'brand-1' });
  });

  it('REFUSES to enqueue on a certificate computed for a different org, and queues nothing', async () => {
    const { scheduleAiVisibilityRun, PreflightOrgMismatchError } = await import('./schedule-run.js');

    await expect(scheduleAiVisibilityRun('run-1', 'org-B', 'brand-1', preflightFor('org-A'))).rejects.toBeInstanceOf(
      PreflightOrgMismatchError,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });
});
