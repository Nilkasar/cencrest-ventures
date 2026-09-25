import { describe, expect, it } from 'vitest';
import {
  computeAiCallCost,
  estimateCost,
  formatMicroUsd,
  InvalidPriceStringError,
  MODEL_PRICING,
  parseDecimalToScaled,
  PRICING_TABLE_VERSION,
  resolveModelPricing,
  sumMicroUsd,
} from './pricing.js';

describe('parseDecimalToScaled', () => {
  it('parses whole and fractional prices exactly, with no float step', () => {
    expect(parseDecimalToScaled('2.50', 9)).toBe(2_500_000_000n);
    expect(parseDecimalToScaled('0.075', 9)).toBe(75_000_000n);
    expect(parseDecimalToScaled('0', 9)).toBe(0n);
    expect(parseDecimalToScaled('15', 9)).toBe(15_000_000_000n);
  });

  it('refuses a price with more precision than the scale can hold rather than truncating it', () => {
    expect(() => parseDecimalToScaled('0.0000001', 6)).toThrow(InvalidPriceStringError);
  });

  it('refuses a non-numeric or negative price', () => {
    expect(() => parseDecimalToScaled('-1.00', 9)).toThrow(InvalidPriceStringError);
    expect(() => parseDecimalToScaled('2,50', 9)).toThrow(InvalidPriceStringError);
    expect(() => parseDecimalToScaled('', 9)).toThrow(InvalidPriceStringError);
  });
});

describe('MODEL_PRICING table integrity', () => {
  it('every committed price parses exactly at the precision the table claims', () => {
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      expect(() => parseDecimalToScaled(pricing.inputPerMillionUsd, 9), key).not.toThrow();
      expect(() => parseDecimalToScaled(pricing.outputPerMillionUsd, 9), key).not.toThrow();
      const cached = pricing.cachedInputPerMillionUsd;
      if (cached !== undefined) {
        expect(() => parseDecimalToScaled(cached, 9), key).not.toThrow();
      }
      const perRequest = pricing.perRequestUsd;
      if (perRequest !== undefined) {
        expect(() => parseDecimalToScaled(perRequest, 6), key).not.toThrow();
      }
    }
  });

  it('covers the default model of every provider the registry can construct', () => {
    // These five are the defaults in `providers/*.ts`. A default model with
    // no price is a silent zero-cost leak, so this test is the tripwire for
    // someone changing a provider default without pricing it.
    for (const model of ['gpt-4o', 'claude-sonnet-4-6', 'gemini-2.0-flash', 'sonar', 'qwen3:8b']) {
      expect(resolveModelPricing(model), model).not.toBeNull();
    }
  });

  it('prices a frontier model far above a cheap one — the whole reason counts are not a cost proxy', () => {
    const cheap = computeAiCallCost({ model: 'gpt-4o-mini', tokensIn: 1000, tokensOut: 1000 });
    const frontier = computeAiCallCost({ model: 'claude-opus-4', tokensIn: 1000, tokensOut: 1000 });
    expect(frontier.micros).toBeGreaterThan(cheap.micros * 20n);
  });
});

describe('resolveModelPricing', () => {
  it('longest-prefix matches a dated snapshot id onto its family', () => {
    expect(resolveModelPricing('gpt-4o-2024-11-20')?.key).toBe('gpt-4o');
    expect(resolveModelPricing('claude-sonnet-4-6')?.key).toBe('claude-sonnet');
    expect(resolveModelPricing('claude-3-5-sonnet-20241022')?.key).toBe('claude-3-5-sonnet');
  });

  it('prefers the more specific family when two prefixes match', () => {
    expect(resolveModelPricing('gemini-2.0-flash-lite-001')?.key).toBe('gemini-2.0-flash-lite');
    expect(resolveModelPricing('gemini-2.0-flash-001')?.key).toBe('gemini-2.0-flash');
    expect(resolveModelPricing('sonar-pro')?.key).toBe('sonar-pro');
    expect(resolveModelPricing('sonar')?.key).toBe('sonar');
  });

  it("normalizes Google's models/ prefix and Ollama's tag separator", () => {
    expect(resolveModelPricing('models/gemini-2.5-pro')?.key).toBe('gemini-2.5-pro');
    expect(resolveModelPricing('qwen3:8b')?.key).toBe('qwen3');
  });

  it('returns null for an unknown model rather than guessing a price', () => {
    expect(resolveModelPricing('some-brand-new-model-v9')).toBeNull();
    expect(resolveModelPricing('')).toBeNull();
  });
});

describe('computeAiCallCost', () => {
  it('computes a known cost exactly', () => {
    // gpt-4o: $2.50/M in, $10.00/M out.
    // 1,000 in  = 1000 * 2.50 / 1e6 = $0.002500
    // 500   out = 500 * 10.00 / 1e6 = $0.005000
    const cost = computeAiCallCost({ model: 'gpt-4o', tokensIn: 1000, tokensOut: 500 });
    expect(cost.micros).toBe(7500n);
    expect(cost.usd).toBe('0.007500');
    expect(cost.pricingFound).toBe(true);
    expect(cost.pricingKey).toBe('gpt-4o');
    expect(cost.pricingTableVersion).toBe(PRICING_TABLE_VERSION);
  });

  it('rounds half-up to the 6 decimal places `Decimal(10,6)` stores', () => {
    // 1 token in on gpt-4o = $0.0000025 → 2.5 micros → 3 micros.
    expect(computeAiCallCost({ model: 'gpt-4o', tokensIn: 1, tokensOut: 0 }).usd).toBe('0.000003');
    // 1 token in on gpt-4o-mini = $0.00000015 → 0.15 micros → 0 micros.
    expect(computeAiCallCost({ model: 'gpt-4o-mini', tokensIn: 1, tokensOut: 0 }).micros).toBe(0n);
  });

  it("adds Perplexity's flat per-request search fee on top of tokens", () => {
    // sonar: $1.00/M both directions + $0.005/request.
    // 1,000 in + 1,000 out = $0.002000; + $0.005000 fee = $0.007000
    const cost = computeAiCallCost({ model: 'sonar', tokensIn: 1000, tokensOut: 1000 });
    expect(cost.usd).toBe('0.007000');
  });

  it('charges the per-request fee once per request when several are aggregated', () => {
    const cost = computeAiCallCost({ model: 'sonar', tokensIn: 0, tokensOut: 0, requests: 4 });
    expect(cost.usd).toBe('0.020000');
  });

  it('reports a self-hosted model as a real zero, distinguishable from an unpriced one', () => {
    const local = computeAiCallCost({ model: 'qwen3:8b', tokensIn: 10_000, tokensOut: 10_000 });
    expect(local.micros).toBe(0n);
    expect(local.pricingFound).toBe(true);
    expect(local.selfHosted).toBe(true);
  });

  it('flags an unknown model as unpriced instead of throwing or inventing a price', () => {
    const unknown = computeAiCallCost({ model: 'totally-new-model', tokensIn: 5000, tokensOut: 5000 });
    expect(unknown.micros).toBe(0n);
    expect(unknown.pricingFound).toBe(false);
    expect(unknown.selfHosted).toBe(false);
    expect(unknown.pricingKey).toBeNull();
  });

  it('treats negative or fractional token counts defensively', () => {
    expect(computeAiCallCost({ model: 'gpt-4o', tokensIn: -5, tokensOut: 0 }).micros).toBe(0n);
    expect(computeAiCallCost({ model: 'gpt-4o', tokensIn: 1000.9, tokensOut: 0 }).micros).toBe(2500n);
  });

  it('estimateCost is the same pure computation, for the follow-up pre-flight estimator', () => {
    expect(estimateCost('gpt-4o', 1000, 500)).toEqual(computeAiCallCost({ model: 'gpt-4o', tokensIn: 1000, tokensOut: 500 }));
  });
});

describe('accumulation over a realistic monthly volume', () => {
  // The float-drift case. 17,000 calls is roughly one month of a single
  // paying org's GEO runs (1,400 prompts x 4 assistants x ~3 runs), which is
  // exactly the scale at which a `number` accumulator stops being trustworthy.
  const CALLS = 17_000;
  const TOKENS_IN = 1337;
  const TOKENS_OUT = 977;

  it('sums 17,000 calls to an exact figure in BigInt micro-dollars', () => {
    const perCall = computeAiCallCost({ model: 'gpt-4o', tokensIn: TOKENS_IN, tokensOut: TOKENS_OUT });
    // 1337 * 2.50 + 977 * 10.00 = 3342.5 + 9770 = 13112.5 micro-dollars → 13113 (half-up).
    expect(perCall.micros).toBe(13_113n);

    const total = sumMicroUsd(Array.from({ length: CALLS }, () => perCall.micros));
    expect(total).toBe(13_113n * BigInt(CALLS));
    expect(formatMicroUsd(total)).toBe('222.921000');
  });

  it('is bit-stable: summing is associative and order-independent, unlike a float accumulator', () => {
    const perCall = computeAiCallCost({ model: 'gpt-4o', tokensIn: TOKENS_IN, tokensOut: TOKENS_OUT }).micros;

    const forward = sumMicroUsd(Array.from({ length: CALLS }, () => perCall));
    const halves =
      sumMicroUsd(Array.from({ length: CALLS / 2 }, () => perCall)) +
      sumMicroUsd(Array.from({ length: CALLS / 2 }, () => perCall));
    expect(halves).toBe(forward);

    // The float version of the same arithmetic, for contrast: accumulating
    // the per-call dollar amount as a `number` does not land on a clean
    // figure, and the error grows with call volume. This assertion pins that
    // the naive approach really is wrong, so nobody "simplifies" the BigInt
    // math back into floats later.
    let floatTotal = 0;
    const floatPerCall = (TOKENS_IN * 2.5) / 1e6 + (TOKENS_OUT * 10) / 1e6;
    for (let i = 0; i < CALLS; i++) floatTotal += floatPerCall;
    expect(floatTotal).not.toBe(floatPerCall * CALLS);
    expect(Math.abs(floatTotal - floatPerCall * CALLS)).toBeGreaterThan(1e-11);
  });
});

describe('formatMicroUsd', () => {
  it('always renders exactly 6 decimal places, the `Decimal(10,6)` shape', () => {
    expect(formatMicroUsd(0n)).toBe('0.000000');
    expect(formatMicroUsd(1n)).toBe('0.000001');
    expect(formatMicroUsd(1_000_000n)).toBe('1.000000');
    expect(formatMicroUsd(1_234_567n)).toBe('1.234567');
    expect(formatMicroUsd(9_999_999_999n)).toBe('9999.999999');
  });
});
