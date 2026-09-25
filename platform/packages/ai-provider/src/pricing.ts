/**
 * MODEL COST TABLE — the single place a human edits when a provider changes
 * its prices.
 *
 * Why this exists: plan limits cap query COUNTS, but a frontier-model call
 * can cost ~20x a cheap one and both count as "1 query." Without a price
 * per model there is no way to know what an organization actually costs to
 * serve, so tiers cannot be priced and margin cannot be defended. This file
 * is the price half of that measurement; `@bebest/api`'s
 * `lib/ai-usage/record.ts` writes the resulting dollars to `ai_usage`.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ HOW TO UPDATE PRICES (read this before editing anything below)       │
 * │                                                                      │
 * │ 1. Edit the entry in `MODEL_PRICING`. Prices are DECIMAL STRINGS in  │
 * │    USD per 1,000,000 tokens — never JS number literals, so a price   │
 * │    can never be mangled by float parsing on its way into the table.  │
 * │ 2. Bump `PRICING_TABLE_VERSION` to today's date (YYYY-MM-DD).        │
 * │ 3. Set `PRICING_LAST_VERIFIED` to the date you actually opened the   │
 * │    provider's public pricing page and compared, and note the page in │
 * │    the entry's `source` field.                                       │
 * │ 4. Do NOT retro-recompute historical `ai_usage.cost_usd` rows: they  │
 * │    are a record of what the call cost AT THE TIME, the same          │
 * │    "versioned, never silently restated" rule ADR-004 applies to      │
 * │    scoring formulas.                                                 │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * !!! THE COMMITTED NUMBERS BELOW ARE A STARTING POINT, NOT VERIFIED !!!
 * They are realistic public list rates for each model family as understood
 * at the date in `PRICING_TABLE_VERSION`, committed so metering produces
 * usable dollars from day one instead of zeros. EVERY entry must be checked
 * against the provider's current public pricing page before launch — see
 * `TECHNICAL_DEBT.md`. Treat any cost figure in a customer-visible surface
 * as an estimate until that pass is done.
 *
 * Deliberately NOT in scope here (a follow-up task owns these): the response
 * cache, dollar-based entitlement enforcement, and the pre-flight run cost
 * estimator. This module is the sensor; nothing here blocks, throttles, or
 * refuses a call. `estimateCost()` exists only so that follow-up has a
 * pure, side-effect-free entry point to build on.
 */

/** Bumped by hand whenever any price below changes. Stored nowhere yet —
 * exported so a future `ai_usage` column (or a cost report header) can
 * record which table version produced a figure. */
export const PRICING_TABLE_VERSION = '2026-09-25';

/** The date a human last compared this whole table against the providers'
 * public pricing pages. `null` means NOBODY HAS — which is the honest
 * current state. */
export const PRICING_LAST_VERIFIED: string | null = null;

export interface ModelPricing {
  /** USD per 1,000,000 input/prompt tokens, as a decimal string. */
  inputPerMillionUsd: string;
  /** USD per 1,000,000 output/completion tokens, as a decimal string. */
  outputPerMillionUsd: string;
  /**
   * USD per 1,000,000 cached input tokens, when the provider bills cache
   * reads at a discount. RECORDED BUT NOT YET APPLIED by `computeAiCallCost`
   * — see that function's comment. Leaving it unapplied over-estimates cost
   * slightly, which is the safe direction for a margin sensor.
   */
  cachedInputPerMillionUsd?: string;
  /**
   * Flat USD charged per request, on top of tokens. Perplexity bills a
   * per-request search fee this way, which is a material share of the cost
   * of a Sonar call and would be invisible in a tokens-only model.
   */
  perRequestUsd?: string;
  /** True for models we run ourselves (Ollama) — no marginal vendor cost,
   * so a zero here is a real zero, not a missing price. */
  selfHosted?: boolean;
  /** Where a human should look to verify this entry. */
  source?: string;
}

/**
 * Keyed by model FAMILY, longest-prefix matched against the model id the
 * provider echoes back (`gpt-4o-2024-11-20` → `gpt-4o`), so a dated
 * snapshot id does not silently fall through to "unpriced."
 *
 * UNVERIFIED — see the banner at the top of this file.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // ---- OpenAI — https://openai.com/api/pricing/ -------------------------
  'gpt-4o-mini': {
    inputPerMillionUsd: '0.15',
    outputPerMillionUsd: '0.60',
    cachedInputPerMillionUsd: '0.075',
    source: 'https://openai.com/api/pricing/',
  },
  'gpt-4o': {
    inputPerMillionUsd: '2.50',
    outputPerMillionUsd: '10.00',
    cachedInputPerMillionUsd: '1.25',
    source: 'https://openai.com/api/pricing/',
  },
  'gpt-4.1-mini': {
    inputPerMillionUsd: '0.40',
    outputPerMillionUsd: '1.60',
    cachedInputPerMillionUsd: '0.10',
    source: 'https://openai.com/api/pricing/',
  },
  'gpt-4.1': {
    inputPerMillionUsd: '2.00',
    outputPerMillionUsd: '8.00',
    cachedInputPerMillionUsd: '0.50',
    source: 'https://openai.com/api/pricing/',
  },
  'gpt-4-turbo': {
    inputPerMillionUsd: '10.00',
    outputPerMillionUsd: '30.00',
    source: 'https://openai.com/api/pricing/',
  },

  // ---- Anthropic — https://www.anthropic.com/pricing#api ---------------
  // NOTE: for Anthropic, `completion_tokens` (output) is where nearly all
  // the money is — a 20x input/output ratio, so a verbose GEO answer is the
  // expensive case, not a long prompt.
  'claude-haiku': {
    inputPerMillionUsd: '0.80',
    outputPerMillionUsd: '4.00',
    source: 'https://www.anthropic.com/pricing#api',
  },
  'claude-3-5-haiku': {
    inputPerMillionUsd: '0.80',
    outputPerMillionUsd: '4.00',
    source: 'https://www.anthropic.com/pricing#api',
  },
  'claude-sonnet': {
    inputPerMillionUsd: '3.00',
    outputPerMillionUsd: '15.00',
    cachedInputPerMillionUsd: '0.30',
    source: 'https://www.anthropic.com/pricing#api',
  },
  'claude-3-5-sonnet': {
    inputPerMillionUsd: '3.00',
    outputPerMillionUsd: '15.00',
    source: 'https://www.anthropic.com/pricing#api',
  },
  'claude-opus': {
    inputPerMillionUsd: '15.00',
    outputPerMillionUsd: '75.00',
    cachedInputPerMillionUsd: '1.50',
    source: 'https://www.anthropic.com/pricing#api',
  },

  // ---- Google — https://ai.google.dev/gemini-api/docs/pricing ----------
  'gemini-1.5-flash': {
    inputPerMillionUsd: '0.075',
    outputPerMillionUsd: '0.30',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  'gemini-1.5-pro': {
    inputPerMillionUsd: '1.25',
    outputPerMillionUsd: '5.00',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  'gemini-2.0-flash-lite': {
    inputPerMillionUsd: '0.075',
    outputPerMillionUsd: '0.30',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  'gemini-2.0-flash': {
    inputPerMillionUsd: '0.10',
    outputPerMillionUsd: '0.40',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  'gemini-2.5-flash': {
    inputPerMillionUsd: '0.30',
    outputPerMillionUsd: '2.50',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  'gemini-2.5-pro': {
    inputPerMillionUsd: '1.25',
    outputPerMillionUsd: '10.00',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },

  // ---- Perplexity — https://docs.perplexity.ai/guides/pricing ----------
  // `perRequestUsd` is the search fee (billed per 1,000 requests on the
  // public page — divided out to per-request here). Ignoring it would
  // understate a Sonar call's cost by more than its token cost at short
  // response lengths, which is exactly the kind of invisible leak this
  // whole task exists to close.
  'sonar-reasoning-pro': {
    inputPerMillionUsd: '2.00',
    outputPerMillionUsd: '8.00',
    perRequestUsd: '0.005',
    source: 'https://docs.perplexity.ai/guides/pricing',
  },
  'sonar-reasoning': {
    inputPerMillionUsd: '1.00',
    outputPerMillionUsd: '5.00',
    perRequestUsd: '0.005',
    source: 'https://docs.perplexity.ai/guides/pricing',
  },
  'sonar-pro': {
    inputPerMillionUsd: '3.00',
    outputPerMillionUsd: '15.00',
    perRequestUsd: '0.005',
    source: 'https://docs.perplexity.ai/guides/pricing',
  },
  sonar: {
    inputPerMillionUsd: '1.00',
    outputPerMillionUsd: '1.00',
    perRequestUsd: '0.005',
    source: 'https://docs.perplexity.ai/guides/pricing',
  },

  // ---- Ollama (self-hosted, local dev) ---------------------------------
  // Zero MARGINAL vendor cost. Tokens are still recorded so local volume is
  // visible and a later "what would this have cost on a cloud model"
  // question is answerable from the same rows.
  qwen3: { inputPerMillionUsd: '0', outputPerMillionUsd: '0', selfHosted: true },
  llama3: { inputPerMillionUsd: '0', outputPerMillionUsd: '0', selfHosted: true },
  mistral: { inputPerMillionUsd: '0', outputPerMillionUsd: '0', selfHosted: true },
};

// ---------------------------------------------------------------------------
// Exact decimal arithmetic
// ---------------------------------------------------------------------------
//
// `ai_usage.cost_usd` is `Decimal(10,6)` — six decimal places, i.e. whole
// micro-dollars. Everything below works in BigInt so 17,000 calls summed
// give the same answer every time; a `number` accumulator drifts (see
// `pricing.test.ts`, which pins the drift a float version would produce).

/** Micro-dollars (1e-6 USD) — the unit `Decimal(10,6)` stores. */
export type MicroUsd = bigint;

/** Internal working scale: prices are held as (USD per 1M tokens) x 1e9,
 * so `tokens * scaledPrice / 1e9` is exactly the cost in micro-dollars. */
const PRICE_SCALE = 9;
const PRICE_SCALE_DIVISOR = 1_000_000_000n;
const MICROS_PER_USD = 1_000_000n;

export class InvalidPriceStringError extends Error {
  constructor(value: string, reason: string) {
    super(`Invalid price string "${value}": ${reason}`);
    this.name = 'InvalidPriceStringError';
  }
}

/**
 * Parses a non-negative decimal string into a BigInt scaled by `10^scale`,
 * with no float step anywhere. Throws rather than truncating if the string
 * carries more precision than `scale` can hold — a silently-rounded price
 * is a silently-wrong invoice.
 */
export function parseDecimalToScaled(value: string, scale: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidPriceStringError(value, 'expected a non-negative decimal like "2.50"');
  }
  const [whole, fraction = ''] = trimmed.split('.') as [string, string?];
  if (fraction.length > scale) {
    throw new InvalidPriceStringError(value, `more than ${scale} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(scale, '0'));
}

/** Renders micro-dollars as a fixed 6-decimal string — the exact shape
 * Prisma hands to a `Decimal(10,6)` column without any float round trip. */
export function formatMicroUsd(micros: MicroUsd): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_USD;
  const frac = (abs % MICROS_PER_USD).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/** Largest value `Decimal(10,6)` can hold: 9999.999999. A single call can
 * never approach this, but a caller that ever sums before storing should
 * know where the column stops. */
export const MAX_COST_MICRO_USD: MicroUsd = 9_999_999_999n;

/**
 * Longest-prefix match of a provider-reported model id against
 * `MODEL_PRICING`. Handles the three shapes providers actually return:
 * a bare family (`sonar`), a dated snapshot (`gpt-4o-2024-11-20`), and
 * Google's resource-path/version forms (`models/gemini-2.0-flash-001`).
 * Ollama's `qwen3:8b` tag separator is normalized too.
 */
export function resolveModelPricing(model: string): { key: string; pricing: ModelPricing } | null {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/:/g, '-');
  if (normalized.length === 0) return null;

  let best: { key: string; pricing: ModelPricing } | null = null;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized === key || normalized.startsWith(`${key}-`)) {
      if (!best || key.length > best.key.length) best = { key, pricing };
    }
  }
  return best;
}

export interface AiCallCostInput {
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** How many billed requests this figure covers. Defaults to 1; only
   * matters for models with a `perRequestUsd` fee. */
  requests?: number;
}

export interface AiCallCost {
  /** Exact cost in micro-dollars, rounded half-up to the column's 6dp. */
  micros: MicroUsd;
  /** `micros` as the fixed-6dp string to hand Prisma. */
  usd: string;
  /** FALSE means no price is known for this model: `micros` is 0 and the
   * spend is being UNDER-counted. Callers must log this loudly — a zero
   * that means "free" and a zero that means "unpriced" must never be
   * confused. `selfHosted` distinguishes the legitimate zero. */
  pricingFound: boolean;
  /** The `MODEL_PRICING` key that matched, for auditability. */
  pricingKey: string | null;
  selfHosted: boolean;
  pricingTableVersion: string;
}

/**
 * (model, tokens_in, tokens_out) → USD, exactly.
 *
 * Cached-input discounts are NOT applied even when `cachedInputPerMillionUsd`
 * is known: the adapters report `cachedPromptTokens` for observability, but
 * billing every input token at the full rate over-states cost, and a margin
 * sensor that errs high is safe while one that errs low is not. Applying the
 * discount is a deliberate, testable follow-up, not an oversight.
 */
export function computeAiCallCost(input: AiCallCostInput): AiCallCost {
  const match = resolveModelPricing(input.model);
  const tokensIn = BigInt(Math.max(0, Math.trunc(input.tokensIn)));
  const tokensOut = BigInt(Math.max(0, Math.trunc(input.tokensOut)));
  const requests = BigInt(Math.max(0, Math.trunc(input.requests ?? 1)));

  if (!match) {
    return {
      micros: 0n,
      usd: formatMicroUsd(0n),
      pricingFound: false,
      pricingKey: null,
      selfHosted: false,
      pricingTableVersion: PRICING_TABLE_VERSION,
    };
  }

  const inScaled = parseDecimalToScaled(match.pricing.inputPerMillionUsd, PRICE_SCALE);
  const outScaled = parseDecimalToScaled(match.pricing.outputPerMillionUsd, PRICE_SCALE);

  // Units here are (micro-dollars x 1e9); one rounding step, at the end.
  const scaled = tokensIn * inScaled + tokensOut * outScaled;
  let micros = (scaled + PRICE_SCALE_DIVISOR / 2n) / PRICE_SCALE_DIVISOR;

  if (match.pricing.perRequestUsd !== undefined) {
    micros += requests * parseDecimalToScaled(match.pricing.perRequestUsd, 6);
  }

  return {
    micros,
    usd: formatMicroUsd(micros),
    pricingFound: true,
    pricingKey: match.key,
    selfHosted: match.pricing.selfHosted === true,
    pricingTableVersion: PRICING_TABLE_VERSION,
  };
}

/**
 * Side-effect-free "what would this cost" for a hypothetical call. Exists
 * so the pre-flight run estimator (explicitly out of scope for this task)
 * has a seam to build on without reaching into the table itself.
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number, requests = 1): AiCallCost {
  return computeAiCallCost({ model, tokensIn, tokensOut, requests });
}

/** Sums per-call micro-dollar figures. Trivial, but exported so aggregation
 * happens in BigInt at every call site rather than someone reaching for
 * `Number(...)` and reintroducing drift. */
export function sumMicroUsd(values: Iterable<MicroUsd>): MicroUsd {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
