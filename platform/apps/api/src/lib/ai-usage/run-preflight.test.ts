import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AIProviderRegistry, type AIProvider } from '@bebest/ai-provider';
import type { CostBudgetExceededError as CostRefusal } from './cost-entitlements.js';

const db = {
  subscriptions: { findUnique: vi.fn() },
  ai_usage: { aggregate: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.ai_usage.aggregate.mockResolvedValue({ _sum: { cost_usd: null } });
});

/** See cost-entitlements.test.ts's copy — asserts a refusal actually happened
 * rather than type-widening a resolved value into the error's shape. */
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

function fakeProvider(name: string, model: string) {
  return {
    name,
    model,
    complete: vi.fn(),
    extract: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as AIProvider & { healthCheck: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };
}

/** The four real cloud assistants a GEO run fans out to, plus the local
 * extraction model — the same routing the default registry produces. */
function fakeRegistry() {
  const providers = {
    openai: fakeProvider('openai', 'gpt-4o'),
    anthropic: fakeProvider('anthropic', 'claude-sonnet-4-6'),
    google: fakeProvider('google', 'gemini-2.0-flash'),
    perplexity: fakeProvider('perplexity', 'sonar'),
    ollama: fakeProvider('ollama', 'qwen3:8b'),
  };
  return { registry: new AIProviderRegistry({ default: 'ollama', providers }), providers };
}

describe('preflightAiVisibilityRunCost', () => {
  it('REFUSES a real Pro baseline (1,400 queries x 4 models) on the per-run ceiling — the exact case a Pro customer can trigger today', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' }); // $6/run, $15/month
    const { preflightAiVisibilityRunCost } = await import('./run-preflight.js');
    const { registry } = fakeRegistry();

    const err = await catchRefusal(preflightAiVisibilityRunCost({
      organizationId: 'org-1',
      queryCount: 1400,
      registry,
    }));

    expect(err.ceiling).toBe('max_cost_per_run_usd');
    expect(err.estimate.totalCalls).toBe(11_200); // 5,600 GEO + 5,600 extraction
    expect(Number(err.projectedUsd)).toBeGreaterThan(6);
  });

  it('ALLOWS the same baseline on a tier whose ceilings can fund it', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'pro' }); // $300/run, $1,200/month
    const { preflightAiVisibilityRunCost } = await import('./run-preflight.js');
    const { registry } = fakeRegistry();

    const preflight = await preflightAiVisibilityRunCost({ organizationId: 'org-1', queryCount: 1400, registry });

    expect(preflight.checked).toBe(true);
    expect(preflight.plan).toBe('pro');
    expect(Number(preflight.projectedUsd)).toBeGreaterThan(0);
    expect(preflight.remainingMicros).not.toBeNull();
  });

  it('pricing a run NEVER makes a provider call and NEVER calls healthCheck — Perplexity bills for one', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'pro' });
    const { preflightAiVisibilityRunCost } = await import('./run-preflight.js');
    const { registry, providers } = fakeRegistry();

    await preflightAiVisibilityRunCost({ organizationId: 'org-1', queryCount: 1400, registry });

    for (const provider of Object.values(providers)) {
      expect(provider.healthCheck).not.toHaveBeenCalled();
      expect(provider.complete).not.toHaveBeenCalled();
    }
  });

  it('reads month-to-date spend from ai_usage and counts it against the monthly budget', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'pro' });
    db.ai_usage.aggregate.mockResolvedValue({ _sum: { cost_usd: '1199.500000' } });
    const { preflightAiVisibilityRunCost } = await import('./run-preflight.js');
    const { registry } = fakeRegistry();

    const err = await catchRefusal(preflightAiVisibilityRunCost({ organizationId: 'org-1', queryCount: 1400, registry }));

    expect(err.ceiling).toBe('ai_cost_budget_usd_per_month');
    expect(err.currentUsd).toBe('1199.500000');
    expect(err.remainingUsd).toBe('0.500000');
  });

  it('a small run on a free plan is allowed — the valve refuses over-spend, not activity', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
    const { preflightAiVisibilityRunCost } = await import('./run-preflight.js');
    const { registry } = fakeRegistry();

    const preflight = await preflightAiVisibilityRunCost({ organizationId: 'org-1', queryCount: 50, registry });

    expect(preflight.checked).toBe(true);
    expect(Number(preflight.projectedUsd)).toBeLessThan(6);
  });
});

describe('estimateRunForOrg', () => {
  it('projects the Perplexity per-request search fee, which appears in no response field', async () => {
    const { estimateRunForOrg } = await import('./run-preflight.js');
    const { registry } = fakeRegistry();

    const estimate = estimateRunForOrg({ queryCount: 1400, registry });
    const sonar = estimate.lines.find((l) => l.model === 'sonar');

    expect(sonar).toBeDefined();
    // 1,400 calls x $0.005 = $7.00 of fees alone, on top of tokens.
    expect(sonar?.micros).toBeGreaterThan(7_000_000n);
  });
});
