import { describe, expect, it, vi } from 'vitest';
import { AIProviderRegistry, type AIProvider } from '@bebest/ai-provider';
import {
  DEFAULT_RUN_TOKEN_PROFILE,
  describeRunModels,
  estimateAiVisibilityRunCost,
  estimateBatchedCallCost,
} from './run-cost-estimator.js';

/** A hand-rolled fake — never a real network call (repo-wide hard
 * constraint). `healthCheck` is a spy specifically so the "an estimate never
 * bills anything" test below can prove it was not touched. */
function fakeProvider(name: string, model: string): AIProvider & { healthCheck: ReturnType<typeof vi.fn> } {
  return {
    name,
    model,
    complete: vi.fn(),
    extract: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as AIProvider & { healthCheck: ReturnType<typeof vi.fn> };
}

describe('estimateBatchedCallCost — arithmetic against a known token/price fixture', () => {
  it('prices a single batch exactly: gpt-4o at $2.50/$10.00 per 1M tokens', () => {
    // Explicit fixture tokens (NOT the default profile) so the arithmetic is
    // pinned independently of profile re-calibration:
    // 1,000 calls x 200 in = 200,000 input tokens -> 200000 * 2.50 / 1e6 = $0.50
    // 1,000 calls x 800 out = 800,000 output tokens -> 800000 * 10.00 / 1e6 = $8.00
    // total $8.50 = 8,500,000 micro-dollars. No per-request fee for OpenAI.
    const estimate = estimateBatchedCallCost(
      [
        {
          provider: 'openai',
          model: 'gpt-4o',
          kind: 'geo_query',
          calls: 1000,
          tokensInPerCall: 200,
          tokensOutPerCall: 800,
        },
      ],
      DEFAULT_RUN_TOKEN_PROFILE,
    );

    expect(estimate.micros).toBe(8_500_000n);
    expect(estimate.usd).toBe('8.500000');
    expect(estimate.totalCalls).toBe(1000);
    expect(estimate.unpricedModels).toEqual([]);
  });

  it('INCLUDES a per-request fee that appears in no response field: Perplexity sonar', () => {
    // sonar: $1.00 in / $1.00 out per 1M, plus $0.005 PER REQUEST.
    // 1,400 calls x (200 + 800) = 1,400,000 tokens -> $1.40 in tokens.
    // 1,400 requests x $0.005 = $7.00 in search fees — five times the token
    // cost, and invisible to any tokens-only estimate.
    const estimate = estimateBatchedCallCost(
      [
        {
          provider: 'perplexity',
          model: 'sonar',
          kind: 'geo_query',
          calls: 1400,
          tokensInPerCall: 200,
          tokensOutPerCall: 800,
        },
      ],
      DEFAULT_RUN_TOKEN_PROFILE,
    );

    expect(estimate.micros).toBe(8_400_000n); // $1.40 tokens + $7.00 fees
    expect(estimate.usd).toBe('8.400000');
  });

  it('a tokens-only estimate would have been 5x too low for Perplexity — the fee is the majority of the cost', () => {
    const withFees = estimateBatchedCallCost(
      [{ provider: 'perplexity', model: 'sonar', kind: 'geo_query', calls: 1400, tokensInPerCall: 200, tokensOutPerCall: 800 }],
      DEFAULT_RUN_TOKEN_PROFILE,
    );
    const tokensOnly = 1_400_000n; // $1.40
    expect(withFees.micros - tokensOnly).toBe(7_000_000n);
  });

  it('flags an unpriced model instead of silently reporting $0 as "free"', () => {
    const estimate = estimateBatchedCallCost(
      [
        {
          provider: 'openai',
          model: 'some-unreleased-model-9',
          kind: 'geo_query',
          calls: 10,
          tokensInPerCall: 100,
          tokensOutPerCall: 100,
        },
      ],
      DEFAULT_RUN_TOKEN_PROFILE,
    );

    expect(estimate.micros).toBe(0n);
    expect(estimate.unpricedModels).toEqual(['some-unreleased-model-9']);
    expect(estimate.lines[0]?.pricingFound).toBe(false);
  });

  it('a self-hosted zero is a real zero, not a missing price', () => {
    const estimate = estimateBatchedCallCost(
      [{ provider: 'ollama', model: 'qwen3:8b', kind: 'extraction', calls: 5600, tokensInPerCall: 1400, tokensOutPerCall: 250 }],
      DEFAULT_RUN_TOKEN_PROFILE,
    );
    expect(estimate.micros).toBe(0n);
    expect(estimate.unpricedModels).toEqual([]);
    expect(estimate.lines[0]?.selfHosted).toBe(true);
  });
});

describe('estimateAiVisibilityRunCost', () => {
  const FOUR_CLOUD = [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'google', model: 'gemini-2.0-flash' },
    { provider: 'perplexity', model: 'sonar' },
  ];

  it('prices a real Pro baseline (1,400 queries x 4 models) at a material, non-trivial number', () => {
    const estimate = estimateAiVisibilityRunCost({
      queryCount: 1400,
      geoModels: FOUR_CLOUD,
      extractionModels: [{ provider: 'ollama', model: 'qwen3:8b' }],
    });

    // 1,400 x 4 = 5,600 GEO calls, plus 5,600 extraction calls.
    expect(estimate.totalCalls).toBe(11_200);
    // Sanity band, not a golden number: a baseline is tens of dollars, and
    // the point of the valve is that this is comparable to a subscription.
    // The default profile is calibrated so this lands at the LOW end of the
    // measured $80-250 band for a real baseline — see
    // DEFAULT_RUN_TOKEN_PROFILE's `geoTokensOut` note.
    expect(estimate.micros).toBeGreaterThan(80_000_000n); // > $80
    expect(estimate.micros).toBeLessThan(250_000_000n); // < $250
    expect(estimate.unpricedModels).toEqual([]);
  });

  it('counts BOTH calls per job — a GEO query and a separate extraction, per pipeline.ts', () => {
    const geoOnly = estimateAiVisibilityRunCost({ queryCount: 10, geoModels: FOUR_CLOUD, extractionModels: [] });
    const withExtraction = estimateAiVisibilityRunCost({
      queryCount: 10,
      geoModels: FOUR_CLOUD,
      extractionModels: [{ provider: 'openai', model: 'gpt-4o-mini' }],
    });

    expect(geoOnly.totalCalls).toBe(40);
    expect(withExtraction.totalCalls).toBe(80);
    // Extraction on a HOSTED model is not free, and must move the number.
    expect(withExtraction.micros).toBeGreaterThan(geoOnly.micros);
  });

  it('scales linearly with query count and with temperatures per query', () => {
    const one = estimateAiVisibilityRunCost({ queryCount: 100, geoModels: FOUR_CLOUD, extractionModels: [] });
    const three = estimateAiVisibilityRunCost({
      queryCount: 100,
      geoModels: FOUR_CLOUD,
      extractionModels: [],
      temperaturesPerQuery: 3,
    });
    expect(three.totalCalls).toBe(one.totalCalls * 3);
    expect(three.micros).toBe(one.micros * 3n);
  });

  it('a zero-query run costs nothing and refuses nothing', () => {
    const estimate = estimateAiVisibilityRunCost({ queryCount: 0, geoModels: FOUR_CLOUD });
    expect(estimate.micros).toBe(0n);
    expect(estimate.totalCalls).toBe(0);
  });
});

describe('describeRunModels', () => {
  it('reads models off the routing table and NEVER calls healthCheck (Perplexity bills for one)', () => {
    const perplexity = fakeProvider('perplexity', 'sonar');
    const openai = fakeProvider('openai', 'gpt-4o');
    const registry = new AIProviderRegistry({ default: 'openai', providers: { openai, perplexity } });

    const models = describeRunModels(registry, 'geo.query');

    expect(models).toEqual([
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'perplexity', model: 'sonar' },
    ]);
    expect(perplexity.healthCheck).not.toHaveBeenCalled();
    expect(openai.healthCheck).not.toHaveBeenCalled();
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it('skips a routed-but-unregistered provider rather than throwing — it makes no calls, so it costs nothing', () => {
    const registry = new AIProviderRegistry({
      default: 'openai',
      providers: { openai: fakeProvider('openai', 'gpt-4o') },
    });
    expect(describeRunModels(registry, 'geo.query')).toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
  });
});
