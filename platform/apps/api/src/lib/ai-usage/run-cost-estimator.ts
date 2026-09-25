/**
 * PRE-FLIGHT RUN COST ESTIMATOR — "what will this run cost BEFORE we
 * dispatch it", built on `@bebest/ai-provider`'s pure `estimateCost` seam.
 *
 * The problem this closes: `routes/ai-runs.ts` counts (queries x providers)
 * and compares that COUNT to a plan cap. A count says nothing about money —
 * 5,600 calls against a frontier model and 5,600 against a mini model differ
 * by ~20x — so a customer could dispatch a run worth more than their whole
 * subscription and every check would pass. This module turns the shape of a
 * run into dollars so `cost-entitlements.ts` can refuse it.
 *
 * THREE THINGS THAT ARE EASY TO GET WRONG AND ARE TESTED HERE:
 *
 * 1. PER-REQUEST FEES. Perplexity charges a flat per-request search fee that
 *    appears in NO response field — it exists only in `pricing.ts`'s
 *    `perRequestUsd`. At a 1,400-query baseline that is 1,400 x $0.005 = $7
 *    of spend that a tokens-only estimate reports as zero. Every call count
 *    is therefore passed to `estimateCost`'s `requests` argument, and the
 *    fee is charged per CALL, not per run.
 *
 * 2. NO HEALTH CHECKS, EVER. `PerplexityProvider.healthCheck()` is itself a
 *    billed request (a `max_tokens: 1` completion plus that same flat search
 *    fee) and returns a bare boolean that cannot be metered. An estimator
 *    that resolved providers via `registry.resolveAvailable()` would spend
 *    real money every time it priced a run it might then refuse. This module
 *    reads models via `resolveNames()` + `registry.get(name).model` — both
 *    pure, in-memory lookups — and `run-cost-estimator.test.ts` asserts the
 *    fake registry's `healthCheck` was never called.
 *
 * 3. UNPRICED MODELS. `estimateCost` returns `pricingFound: false` and $0 for
 *    a model missing from the table. A budget check that treats that as "free"
 *    is a hole, so unpriced models are surfaced on the estimate and the
 *    caller decides (`cost-entitlements.ts` refuses to certify a run whose
 *    estimate contains one when a ceiling is set).
 *
 * The TOKEN PROFILE below is an estimate and is the estimator's single
 * largest source of error. It is a named, overridable constant rather than
 * magic numbers inline precisely so it can be re-fitted from real `ai_usage`
 * rows once a production month exists — that is a measurement task, not a
 * guess to keep re-making here.
 */
import type { AIProviderRegistry, KnownProviderName } from '@bebest/ai-provider';
import { estimateCost, formatMicroUsd, type MicroUsd } from '@bebest/ai-provider';

/** One (provider, model) pair as the run will actually use it. Resolved from
 * the registry's routing table, never hand-listed at a call site. */
export interface ProviderModel {
  provider: string;
  model: string;
}

/**
 * Expected tokens per call, per call KIND. Deliberately separate numbers for
 * the GEO query and the extraction call: they are different prompts against
 * different models (`taskDefaults.extraction` -> Ollama), and the extraction
 * prompt's input is dominated by the GEO answer it is reading, so its input
 * scales with the other call's output.
 *
 * SOURCES / REASONING (all of it erring high, the safe direction for a valve
 * that refuses — being slightly pessimistic delays a run; being optimistic
 * lets a customer outspend their plan):
 *   - `geoTokensIn`: `prompts/geo/brand-query.v1.0.txt` rendered with one
 *     query string is a short prompt; 200 covers it with headroom.
 *   - `geoTokensOut`: an unconstrained assistant answer to a
 *     recommendation-style question. `pipeline.ts` sets no `maxTokens`, so
 *     this is the number with the widest real spread, and output tokens are
 *     where ~95% of a GEO run's money goes. CALIBRATED, not guessed: a
 *     1,400-query x 4-model baseline is known to cost roughly $80-250 in
 *     model spend, and 2,000 output tokens is what puts this estimator's
 *     projection (~$84) at the LOW end of that measured band. A smaller
 *     number here would under-project by 2-6x, which is the one direction a
 *     spend valve must never err.
 *   - `extractionTokensIn`: the extraction template plus the FULL GEO answer
 *     plus `BRAND_OBSERVATION_SCHEMA` — so it tracks `geoTokensOut`.
 *   - `extractionTokensOut`: one `BrandObservation` JSON object.
 *   - `extractionAttempts`: 1. `BaseAIProvider.extract()` retries up to
 *     `retries + 1` (3) times and EVERY attempt is billed, but extraction
 *     runs on a self-hosted model by default, where the marginal cost of a
 *     retry is genuinely zero. Raise this if extraction is ever routed to a
 *     hosted model.
 */
export interface RunTokenProfile {
  geoTokensIn: number;
  geoTokensOut: number;
  extractionTokensIn: number;
  extractionTokensOut: number;
  extractionAttempts: number;
}

export const DEFAULT_RUN_TOKEN_PROFILE: RunTokenProfile = {
  geoTokensIn: 200,
  geoTokensOut: 2000,
  extractionTokensIn: 2800,
  extractionTokensOut: 250,
  extractionAttempts: 1,
};

/** A batch of identical calls to one model. `calls` is the BILLED request
 * count, which is what `perRequestUsd` multiplies against. */
export interface EstimatedCallBatch extends ProviderModel {
  kind: 'geo_query' | 'extraction';
  calls: number;
  tokensInPerCall: number;
  tokensOutPerCall: number;
}

export interface RunCostEstimateLine extends EstimatedCallBatch {
  micros: MicroUsd;
  usd: string;
  pricingFound: boolean;
  pricingKey: string | null;
  selfHosted: boolean;
}

export interface RunCostEstimate {
  micros: MicroUsd;
  usd: string;
  /** Total billed provider requests this run will make. */
  totalCalls: number;
  lines: RunCostEstimateLine[];
  /** Models with no entry in `pricing.ts`. Their spend is counted as $0 in
   * `micros`, so a non-empty array means this estimate is an UNDER-count. */
  unpricedModels: string[];
  profile: RunTokenProfile;
  pricingTableVersion: string;
}

/**
 * Prices a set of call batches. Pure: no I/O, no clock, no network — the
 * arithmetic is `estimateCost`'s, in BigInt micro-dollars, so an estimate
 * and the `ai_usage` rows the run later writes are computed by the same code
 * against the same table.
 *
 * Tokens are multiplied by the call count and the per-request fee is charged
 * per call, which is exactly `estimateCost(model, in*n, out*n, n)`. One
 * rounding step happens inside `estimateCost` per batch rather than per
 * call, so the estimate does not accumulate 5,600 separate half-up roundings.
 */
export function estimateBatchedCallCost(batches: readonly EstimatedCallBatch[], profile: RunTokenProfile): RunCostEstimate {
  const lines: RunCostEstimateLine[] = [];
  const unpriced = new Set<string>();
  let total = 0n;
  let totalCalls = 0;
  let pricingTableVersion = '';

  for (const batch of batches) {
    const calls = Math.max(0, Math.trunc(batch.calls));
    const cost = estimateCost(
      batch.model,
      batch.tokensInPerCall * calls,
      batch.tokensOutPerCall * calls,
      calls,
    );
    pricingTableVersion = cost.pricingTableVersion;
    if (!cost.pricingFound) unpriced.add(batch.model);
    total += cost.micros;
    totalCalls += calls;
    lines.push({
      ...batch,
      calls,
      micros: cost.micros,
      usd: cost.usd,
      pricingFound: cost.pricingFound,
      pricingKey: cost.pricingKey,
      selfHosted: cost.selfHosted,
    });
  }

  return {
    micros: total,
    usd: formatMicroUsd(total),
    totalCalls,
    lines,
    unpricedModels: [...unpriced],
    profile,
    pricingTableVersion,
  };
}

export interface AiVisibilityRunShape {
  /** Queries in the active query set. */
  queryCount: number;
  /** The GEO-query fan-out — all four cloud assistants for a real run. */
  geoModels: readonly ProviderModel[];
  /** The extraction call each GEO answer feeds (Ollama by default). Empty is
   * legitimate: a deployment with no extraction provider registered simply
   * makes no extraction calls. */
  extractionModels?: readonly ProviderModel[];
  /**
   * Distinct temperatures each query is asked at, per model. `pipeline.ts`
   * currently asks exactly ONE (`GEO_QUERY_TEMPERATURE = 0.7`), so this is 1
   * — it exists because a multi-temperature sampling design multiplies the
   * whole run's cost by it, and that must not silently bypass the ceiling.
   */
  temperaturesPerQuery?: number;
  profile?: Partial<RunTokenProfile>;
}

/**
 * The shape of an AI Visibility run -> dollars.
 *
 * Mirrors `lib/ai-visibility/pipeline.ts`'s actual call structure, which is
 * TWO provider calls per (query x provider) job, not one: a `complete()` GEO
 * query, then a SEPARATE `extract()` against a possibly different provider.
 * Estimating only the first would under-count every run by the whole
 * extraction pass — which happens to be ~free today only because extraction
 * is routed to a self-hosted model, and would become a silent hole the day
 * that changes.
 */
export function estimateAiVisibilityRunCost(shape: AiVisibilityRunShape): RunCostEstimate {
  const profile: RunTokenProfile = { ...DEFAULT_RUN_TOKEN_PROFILE, ...shape.profile };
  const queries = Math.max(0, Math.trunc(shape.queryCount));
  const temperatures = Math.max(1, Math.trunc(shape.temperaturesPerQuery ?? 1));
  const geoCallsPerModel = queries * temperatures;

  const batches: EstimatedCallBatch[] = [];

  for (const pm of shape.geoModels) {
    batches.push({
      ...pm,
      kind: 'geo_query',
      calls: geoCallsPerModel,
      tokensInPerCall: profile.geoTokensIn,
      tokensOutPerCall: profile.geoTokensOut,
    });
  }

  // One extraction pass per GEO answer produced — i.e. per GEO call, not per
  // query (each provider's answer is extracted separately).
  const extractionModels = shape.extractionModels ?? [];
  const extractionCalls = geoCallsPerModel * shape.geoModels.length * Math.max(1, profile.extractionAttempts);
  for (const pm of extractionModels) {
    batches.push({
      ...pm,
      kind: 'extraction',
      // A fan-out of extraction providers is not something the routing table
      // does today (`extraction` resolves to a single provider), but if it
      // ever did, each would see the full pass — never a divided one, which
      // would under-count.
      calls: extractionCalls,
      tokensInPerCall: profile.extractionTokensIn,
      tokensOutPerCall: profile.extractionTokensOut,
    });
  }

  return estimateBatchedCallCost(batches, profile);
}

/**
 * Reads the (provider, model) pairs a run will use straight off the
 * registry's routing table.
 *
 * PURE AND UNBILLED BY CONSTRUCTION: `resolveNames` is a table lookup and
 * `.model` is a readonly field, so nothing here can reach a provider's
 * network path. In particular this must never call `resolveAvailable()` or
 * `healthCheckAll()` — see this module's header, point 2.
 *
 * A routed-but-unregistered provider name is SKIPPED rather than thrown on,
 * matching `registry.resolveAvailable()`'s own tolerance: a deployment that
 * never constructed a provider makes no calls to it, so it costs nothing.
 */
export function describeRunModels(registry: AIProviderRegistry, task: string): ProviderModel[] {
  const models: ProviderModel[] = [];
  for (const name of registry.resolveNames(task)) {
    let provider;
    try {
      provider = registry.get(name as KnownProviderName);
    } catch {
      continue;
    }
    models.push({ provider: name, model: provider.model });
  }
  return models;
}
