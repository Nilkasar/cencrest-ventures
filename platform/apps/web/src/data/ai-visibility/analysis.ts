import type { AiRunResponse, AiVisibilityQueryMeta, BrandSentiment } from "./types";

/**
 * Pure, client-side aggregations over an already-fetched
 * `AiRunResponse[]` (see `client.ts`'s `getAllAiRunResponses`) — the "model
 * breakdown," "score by intent," "citation source map," and "sentiment
 * analysis" panels the epic's UI surface asks for, none of which the
 * backend computes or stores itself (only the composite AVS + its four
 * formula components are persisted on `ai_runs`). These are real
 * observation counts, not a re-derivation of the AVS formula — every
 * number here traces directly to a `brand_observations` field, which is
 * the point: each panel is itself a drill-down surface into the same
 * response set the raw-response explorer renders.
 *
 * No React here on purpose — every function takes plain data and returns
 * plain data, so it's trivially testable and reusable across panels.
 */

export type IntentType = NonNullable<AiVisibilityQueryMeta["intentType"]>;

export const INTENT_TYPES: IntentType[] = ["informational", "commercial", "comparison", "transactional"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

export interface ProviderStats {
  provider: string;
  totalJobs: number;
  withRawResponse: number;
  extracted: number;
  extractionFailed: number;
  mentioned: number;
  mentionRatePct: number | null;
  recommended: number;
  recommendationRatePct: number | null;
  avgFirstPosition: number | null;
  avgLatencyMs: number | null;
}

/** One row per provider actually seen in `responses`, in `knownProviders`'
 *  order (falls back to first-seen order for anything not in that list —
 *  defensive only, `AiRun.providers` should already be exhaustive). Rows
 *  for a provider with zero responses so far (a run still `running`) are
 *  included with all-zero/null stats, not omitted, so the panel doesn't
 *  silently shrink mid-run. */
export function computeProviderBreakdown(responses: AiRunResponse[], knownProviders: string[]): ProviderStats[] {
  const order = [...knownProviders];
  for (const r of responses) if (!order.includes(r.provider)) order.push(r.provider);

  return order.map((provider) => {
    const rows = responses.filter((r) => r.provider === provider);
    const extracted = rows.filter((r) => r.extractionStatus === "completed");
    const mentioned = extracted.filter((r) => r.observation?.brandMentioned);
    const recommended = extracted.filter((r) => r.observation?.brandRecommended);
    const positions = mentioned
      .map((r) => r.observation?.brandFirstPosition)
      .filter((p): p is number => typeof p === "number");
    const latencies = rows.map((r) => r.latencyMs).filter((l): l is number => typeof l === "number");

    return {
      provider,
      totalJobs: rows.length,
      withRawResponse: rows.length,
      extracted: extracted.length,
      extractionFailed: rows.filter((r) => r.extractionStatus === "failed").length,
      mentioned: mentioned.length,
      mentionRatePct: pct(mentioned.length, rows.length),
      recommended: recommended.length,
      recommendationRatePct: pct(recommended.length, rows.length),
      avgFirstPosition: avg(positions),
      avgLatencyMs: avg(latencies),
    };
  });
}

export interface IntentStats {
  intentType: IntentType;
  /** Distinct queries of this intent in the run's query set (denominator
   *  for coverage), not just the ones that happen to have a response yet. */
  totalQueries: number;
  /** Distinct queries of this intent with at least one response so far. */
  queriesWithResponses: number;
  totalResponses: number;
  mentioned: number;
  mentionRatePct: number | null;
  recommended: number;
  recommendationRatePct: number | null;
  avgFirstPosition: number | null;
  /** Distinct queries of this intent where the brand was mentioned at
   *  least once — the real "coverage" signal at intent grain. */
  queriesCovered: number;
  coveragePct: number | null;
}

/** Groups `responses` by their query's `intentType` (looked up via
 *  `queryMeta`, keyed by `AiRunResponse.queryId`). A response whose query
 *  can't be resolved (query-set fetch failed, or a genuinely untagged
 *  query) is excluded from every intent's numbers rather than guessed
 *  into one — see the caller for the "N responses have no intent label"
 *  disclosure this implies. */
export function computeIntentBreakdown(
  responses: AiRunResponse[],
  queryMeta: Map<string, AiVisibilityQueryMeta>,
): IntentStats[] {
  return INTENT_TYPES.map((intentType) => {
    const queryIdsOfIntent = new Set(
      [...queryMeta.values()].filter((q) => q.intentType === intentType).map((q) => q.id),
    );
    const rows = responses.filter((r) => queryIdsOfIntent.has(r.queryId));
    const extracted = rows.filter((r) => r.extractionStatus === "completed");
    const mentioned = extracted.filter((r) => r.observation?.brandMentioned);
    const recommended = extracted.filter((r) => r.observation?.brandRecommended);
    const positions = mentioned
      .map((r) => r.observation?.brandFirstPosition)
      .filter((p): p is number => typeof p === "number");

    const queriesWithResponses = new Set(rows.map((r) => r.queryId));
    const queriesCovered = new Set(mentioned.map((r) => r.queryId));

    return {
      intentType,
      totalQueries: queryIdsOfIntent.size,
      queriesWithResponses: queriesWithResponses.size,
      totalResponses: rows.length,
      mentioned: mentioned.length,
      mentionRatePct: pct(mentioned.length, rows.length),
      recommended: recommended.length,
      recommendationRatePct: pct(recommended.length, rows.length),
      avgFirstPosition: avg(positions),
      queriesCovered: queriesCovered.size,
      coveragePct: pct(queriesCovered.size, queryIdsOfIntent.size),
    };
  });
}

/** Every query id in `queryMeta` tagged with `intentType` — used as the
 *  `ResponseFilter.queryIds` facet when a caller drills into one intent
 *  row (see `intent-breakdown-panel.tsx`). Returning "every query of this
 *  intent" rather than "only the ones with a response so far" is
 *  deliberate: `matchesFilter` intersects this with each response's own
 *  `queryId` anyway, so the result is identical, and the broader set stays
 *  correct if new responses for this intent arrive after the caller reads
 *  it (a run still `running`, polling in). */
export function queryIdsForIntent(queryMeta: Map<string, AiVisibilityQueryMeta>, intentType: IntentType): Set<string> {
  const ids = new Set<string>();
  for (const [id, meta] of queryMeta) if (meta.intentType === intentType) ids.add(id);
  return ids;
}

export interface CitedDomainStats {
  domain: string;
  citations: number;
  /** Distinct responses that cited this domain at least once. */
  responseCount: number;
}

/** Every domain any observation cited, across the whole response set,
 *  sorted by citation count descending — the "citation source map." */
export function computeCitationMap(responses: AiRunResponse[]): CitedDomainStats[] {
  const byDomain = new Map<string, { citations: number; responseIds: Set<string> }>();
  for (const r of responses) {
    const domains = r.observation?.citedDomains ?? [];
    for (const domain of domains) {
      const entry = byDomain.get(domain) ?? { citations: 0, responseIds: new Set<string>() };
      entry.citations += 1;
      entry.responseIds.add(r.id);
      byDomain.set(domain, entry);
    }
  }
  return [...byDomain.entries()]
    .map(([domain, v]) => ({ domain, citations: v.citations, responseCount: v.responseIds.size }))
    .sort((a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain));
}

export interface SentimentMix {
  counts: Record<BrandSentiment, number>;
  /** Extracted responses where the brand was mentioned but no sentiment
   *  was extracted (schema allows `null`) — shown separately from the
   *  four real sentiment buckets rather than folded into "neutral". */
  unrated: number;
  /** Denominator: extracted responses with `brandMentioned: true`.
   *  Sentiment is only meaningful once the brand was actually discussed. */
  totalMentioned: number;
}

export function computeSentimentMix(responses: AiRunResponse[]): SentimentMix {
  const counts: Record<BrandSentiment, number> = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  let unrated = 0;
  let totalMentioned = 0;
  for (const r of responses) {
    const obs = r.observation;
    if (!obs || !obs.brandMentioned) continue;
    totalMentioned += 1;
    if (obs.brandSentiment) counts[obs.brandSentiment] += 1;
    else unrated += 1;
  }
  return { counts, unrated, totalMentioned };
}
