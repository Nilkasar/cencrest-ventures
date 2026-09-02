/**
 * Epic 8 (Competitive Intelligence) — pure, deterministic comparison math.
 * Every export here is side-effect-free (no database, no AI provider, no
 * clock) for the same reason `lib/ai-visibility/scoring.ts` is: correctness
 * at the formula boundaries (this epic's DoD explicitly calls out zero-
 * mention/single-competitor Share-of-AI-Voice edge cases) is proven by unit
 * tests against plain object literals, not by exercising the whole route.
 * `routes/competitive-intelligence.ts` is the only caller — it loads real
 * data via `lib/ai-visibility/competitive-dataset.ts`, maps Prisma rows
 * into the small shapes below, and calls these functions.
 *
 * Source: repo-root `docs/11-geo/GEO_ENGINE.md`'s "COMPETITOR INTELLIGENCE
 * IN GEO" / "GEO GAP ANALYSIS" sections (this platform's own `docs/`
 * doesn't carry a copy — see this epic's backend doc for that note).
 * Formulas transcribed verbatim:
 *
 *   Competitive Gap    = Competitor AVS − Your AVS
 *   Share of AI Voice  = Your mentions / (Your mentions + all competitor mentions) × 100
 *
 * Two things the source doc illustrates but does not give a literal
 * extraction rule for, resolved here the same way `scoring.ts` resolves its
 * own two documented ambiguities (comment left in place so a future formula
 * version starts from the same understanding):
 *
 * 1. "Mentions" for Share of AI Voice. `brand_observations` has both a
 *    per-response `brand_mention_count` (occurrences WITHIN one response)
 *    and a boolean `brand_mentioned` (whether a response mentions the
 *    entity at all). This module uses the COUNT OF MENTIONING RESPONSES
 *    (`brand_mentioned === true`, one per (query x provider) observation),
 *    not the summed occurrence count — the same denominator style
 *    `computeMentionScore` already uses for MentionScore, so "share of
 *    voice" and "mention score" agree on what a "mention" is.
 * 2. "At position 1" in the per-query breakdown sentence
 *    ("CompetitorA appears in 84% of responses at position 1"). The
 *    `BrandObservation` schema (see `observation-schema.ts` and
 *    `scoring.ts`'s own comment #2) has no numeric list-rank field — only a
 *    continuous 0..1 `brandFirstPosition` (normalized character offset of
 *    the first mention). `positionBucket` below maps that continuous value
 *    into an ordinal 1–4 by quartile of the response text ("mentioned in
 *    the first quarter of the response" = position 1), the same kind of
 *    documented, data-supported reinterpretation `scoring.ts` used for
 *    "recommended" when the literal "top-3" wording had nothing in the
 *    schema to check it against. This is NOT "the AI ranked this brand
 *    #1 in a list" — no field in this schema records that — it is "of all
 *    (query x provider) responses that mentioned this entity for this
 *    query, the earliest mention landed in the response's Nth quarter."
 */
import { AVS_FORMULA_VERSION, computeAiVisibilityScore, type ScoredObservation } from './scoring.js';

// ── Share of AI Voice ───────────────────────────────────────────────────

export interface ShareOfAiVoiceResult {
  totalMentions: number;
  yourMentions: number;
  yourSharePct: number;
  competitorShares: Record<string, number>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `Your mentions / (Your mentions + all competitor mentions) × 100`.
 *
 * Boundary behavior (this epic's DoD explicitly requires testing these):
 * - Zero mentions anywhere (`totalMentions === 0`): every share is 0, never
 *   NaN/Infinity from a 0/0 division — "no evidence anyone was mentioned"
 *   is reported as a real, sane 0% share, not an undefined one.
 * - Zero competitor mentions, some brand mentions: brand share is exactly
 *   100 (nothing to divide the "voice" with).
 * - A single tracked competitor: this is not a special case at all — the
 *   formula is already defined for any number of competitors (including
 *   one), which is exactly why it's implemented generically over a record
 *   rather than hand-rolled for "you vs. exactly one competitor."
 */
export function computeShareOfAiVoice(yourMentions: number, competitorMentions: Record<string, number>): ShareOfAiVoiceResult {
  const competitorTotal = Object.values(competitorMentions).reduce((sum, n) => sum + n, 0);
  const totalMentions = yourMentions + competitorTotal;

  if (totalMentions <= 0) {
    const zeroShares: Record<string, number> = {};
    for (const key of Object.keys(competitorMentions)) zeroShares[key] = 0;
    return { totalMentions: 0, yourMentions, yourSharePct: 0, competitorShares: zeroShares };
  }

  const competitorShares: Record<string, number> = {};
  for (const [key, mentions] of Object.entries(competitorMentions)) {
    competitorShares[key] = round2((mentions / totalMentions) * 100);
  }

  return {
    totalMentions,
    yourMentions,
    yourSharePct: round2((yourMentions / totalMentions) * 100),
    competitorShares,
  };
}

// ── Competitive Gap ─────────────────────────────────────────────────────

/** `Competitor AVS − Your AVS`. `null` propagates when either side hasn't
 * finished AGGREGATE yet (same "not ready, not an error" convention
 * `serializeAiRunScore` uses) rather than being treated as a zero score. */
export function computeCompetitiveGap(competitorAvs: number | null, yourAvs: number | null): number | null {
  if (competitorAvs === null || yourAvs === null) return null;
  return round2(competitorAvs - yourAvs);
}

/** Groups `queries` by `intent_type` and computes AVS formula v1.0
 * independently for each group, for both entities — the "per intent"
 * half of "Competitive Gap = Competitor AVS − Your AVS (per intent and in
 * aggregate)". Queries with a null `intent_type` are grouped under
 * `'uncategorized'` rather than dropped, so coverage of every query in the
 * set is preserved. */
export interface IntentTypeQuery {
  id: string;
  intentType: string | null;
}

export interface IntentTypeGap {
  intentType: string;
  queryCount: number;
  yourScore: number;
  competitorScore: number;
  gap: number;
}

export function computePerIntentTypeGaps(
  queries: readonly IntentTypeQuery[],
  yourObservations: readonly ScoredObservation[],
  yourTotalProviders: number,
  competitorObservations: readonly ScoredObservation[],
  competitorTotalProviders: number,
): IntentTypeGap[] {
  const groups = new Map<string, string[]>();
  for (const q of queries) {
    const key = q.intentType ?? 'uncategorized';
    const ids = groups.get(key) ?? [];
    ids.push(q.id);
    groups.set(key, ids);
  }

  const results: IntentTypeGap[] = [];
  for (const [intentType, queryIds] of groups) {
    const idSet = new Set(queryIds);
    const yourGroupObs = yourObservations.filter((o) => idSet.has(o.queryId));
    const competitorGroupObs = competitorObservations.filter((o) => idSet.has(o.queryId));

    const yourScore = computeAiVisibilityScore({
      observations: yourGroupObs,
      totalQueries: queryIds.length,
      totalProviders: yourTotalProviders,
    });
    const competitorScore = computeAiVisibilityScore({
      observations: competitorGroupObs,
      totalQueries: queryIds.length,
      totalProviders: competitorTotalProviders,
    });

    results.push({
      intentType,
      queryCount: queryIds.length,
      yourScore: yourScore.aiVisibilityScore,
      competitorScore: competitorScore.aiVisibilityScore,
      gap: round2(competitorScore.aiVisibilityScore - yourScore.aiVisibilityScore),
    });
  }
  return results;
}

// ── Per-query breakdown (the signature evidence sentence) ───────────────

export type PositionBucket = 1 | 2 | 3 | 4;

/** See this file's top comment, ambiguity #2. `firstPosition` must already
 * be the normalized 0..1 offset of a MENTIONED observation (never called
 * for a not-mentioned one — there is no position to bucket). */
export function positionBucket(firstPosition: number): PositionBucket {
  if (firstPosition <= 0.25) return 1;
  if (firstPosition <= 0.5) return 2;
  if (firstPosition <= 0.75) return 3;
  return 4;
}

export interface QueryStats {
  mentionRatePct: number;
  /** `null` when nothing mentioned this entity for this query at all. */
  position: PositionBucket | null;
}

/** `observationsForQuery` must already be filtered to exactly one query's
 * (query x provider) rows for one run. `totalProviders` is the run's own
 * `providers.length` — the fixed denominator (mirrors `computeMentionScore`:
 * a failed/unextracted job still counts against the rate, it doesn't shrink
 * the denominator). */
export function computeQueryStats(observationsForQuery: readonly ScoredObservation[], totalProviders: number): QueryStats {
  if (totalProviders <= 0) return { mentionRatePct: 0, position: null };

  const mentioned = observationsForQuery.filter((o) => o.brandMentioned);
  const mentionRatePct = Math.round((mentioned.length / totalProviders) * 100);

  let bestPosition: number | null = null;
  for (const o of mentioned) {
    if (o.brandFirstPosition === null) continue;
    if (bestPosition === null || o.brandFirstPosition < bestPosition) bestPosition = o.brandFirstPosition;
  }

  return { mentionRatePct, position: bestPosition === null ? null : positionBucket(bestPosition) };
}

function positionPhrase(position: PositionBucket | null): string {
  return position === null ? '' : ` at position ${position}`;
}

/**
 * The product's signature evidence sentence, verbatim-shaped per
 * `docs/11-geo/GEO_ENGINE.md`: 'For "best freight visibility software,"
 * CompetitorA appears in 84% of responses at position 1, you appear in 2%
 * of responses.' The "at position N" clause is omitted (not fabricated as
 * "at position 0" or similar) when that side was never mentioned at all —
 * see `computeQueryStats`.
 */
export function buildQueryComparisonSentence(input: {
  queryText: string;
  competitorName: string;
  competitorStats: QueryStats;
  yourStats: QueryStats;
}): string {
  return (
    `For "${input.queryText}," ${input.competitorName} appears in ${input.competitorStats.mentionRatePct}% of responses` +
    `${positionPhrase(input.competitorStats.position)}, you appear in ${input.yourStats.mentionRatePct}% of responses` +
    `${positionPhrase(input.yourStats.position)}.`
  );
}

// ── Gap classification (the four types, docs/11-geo/GEO_ENGINE.md
// "GEO GAP ANALYSIS") — each independently labeled via `gapType`, per this
// epic's end-to-end flow step 4 ("a UI or report consumer must be able to
// tell which type a given gap is, not infer it"). ───────────────────────

export type GapSeverity = 'high' | 'medium' | 'low';

export interface IntentGapFinding {
  gapType: 'intent_gap';
  severity: GapSeverity;
  queryId: string;
  queryText: string;
  yourMentionRatePct: number;
  competitors: Array<{ competitorId: string; competitorName: string; mentionRatePct: number }>;
}

export interface ContentGapFinding {
  gapType: 'content_gap';
  severity: GapSeverity;
  queryId: string;
  queryText: string;
  citedDomains: string[];
}

export interface EntityGapFinding {
  gapType: 'entity_gap';
  severity: GapSeverity;
  category: string;
  yourPresencePct: number;
  competitors: Array<{ competitorId: string; competitorName: string; presencePct: number }>;
}

export interface SourceGapFinding {
  gapType: 'source_gap';
  severity: GapSeverity;
  domain: string;
  citedByCompetitors: Array<{ competitorId: string; competitorName: string; citationRatePct: number }>;
}

export type GapFinding = IntentGapFinding | ContentGapFinding | EntityGapFinding | SourceGapFinding;

export interface QueryComparisonInput {
  queryId: string;
  queryText: string;
  category: string | null;
  yourStats: QueryStats;
  yourCitedDomains: string[];
  competitors: Array<{ competitorId: string; competitorName: string; stats: QueryStats; citedDomains: string[] }>;
}

/** Type 1 — "Queries where competitors appear but the brand does not."
 * Literal zero-mention-rate reading (not a fuzzy "brand does worse"
 * threshold) — matches GEO_ENGINE.md's own worked example
 * ("Your brand: appears in 0% of responses"). */
export function classifyIntentGaps(rows: readonly QueryComparisonInput[]): IntentGapFinding[] {
  const findings: IntentGapFinding[] = [];
  for (const row of rows) {
    if (row.yourStats.mentionRatePct > 0) continue;
    const present = row.competitors.filter((c) => c.stats.mentionRatePct > 0);
    if (present.length === 0) continue;

    const maxCompetitorRate = Math.max(...present.map((c) => c.stats.mentionRatePct));
    findings.push({
      gapType: 'intent_gap',
      severity: maxCompetitorRate >= 50 ? 'high' : 'medium',
      queryId: row.queryId,
      queryText: row.queryText,
      yourMentionRatePct: row.yourStats.mentionRatePct,
      competitors: present.map((c) => ({ competitorId: c.competitorId, competitorName: c.competitorName, mentionRatePct: c.stats.mentionRatePct })),
    });
  }
  return findings;
}

/** Type 2 — "Topics AI discusses that the brand has no authoritative
 * content for," operationalized per-query: a competitor's responses cite
 * SOME source for this query while the brand's responses cite NONE, and
 * the brand is weakly present (<50% mention rate) — the citation gap is
 * only interesting where the brand isn't already winning the query some
 * other way. */
export function classifyContentGaps(rows: readonly QueryComparisonInput[]): ContentGapFinding[] {
  const findings: ContentGapFinding[] = [];
  for (const row of rows) {
    if (row.yourCitedDomains.length > 0) continue;
    if (row.yourStats.mentionRatePct >= 50) continue;
    const domains = new Set<string>();
    for (const c of row.competitors) for (const d of c.citedDomains) domains.add(d);
    if (domains.size === 0) continue;

    findings.push({
      gapType: 'content_gap',
      severity: 'medium',
      queryId: row.queryId,
      queryText: row.queryText,
      citedDomains: [...domains],
    });
  }
  return findings;
}

/** Type 3 — "AI categories or entities the brand is NOT associated with,"
 * operationalized at the `queries.category` level (Epic 5's ten
 * template-generation categories — GEO_ENGINE.md's own "Category X"
 * language), aggregated across every query tagged with that category
 * rather than one query at a time (an entity/category association is a
 * broader signal than any single query). "Presence" for a query = mentioned
 * at all (mentionRatePct > 0); "presence %" for a category = the fraction
 * of that category's queries where the entity was present. */
export function classifyEntityGaps(rows: readonly QueryComparisonInput[]): EntityGapFinding[] {
  const byCategory = new Map<string, QueryComparisonInput[]>();
  for (const row of rows) {
    if (!row.category) continue;
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  const findings: EntityGapFinding[] = [];
  for (const [category, categoryRows] of byCategory) {
    const yourPresencePct = round2((100 * categoryRows.filter((r) => r.yourStats.mentionRatePct > 0).length) / categoryRows.length);
    if (yourPresencePct > 0) continue;

    const competitorIds = new Set(categoryRows.flatMap((r) => r.competitors.map((c) => c.competitorId)));
    const competitors: EntityGapFinding['competitors'] = [];
    for (const competitorId of competitorIds) {
      const name = categoryRows.flatMap((r) => r.competitors).find((c) => c.competitorId === competitorId)?.competitorName ?? competitorId;
      const presentCount = categoryRows.filter((r) => r.competitors.some((c) => c.competitorId === competitorId && c.stats.mentionRatePct > 0)).length;
      const presencePct = round2((100 * presentCount) / categoryRows.length);
      if (presencePct > 0) competitors.push({ competitorId, competitorName: name, presencePct });
    }
    if (competitors.length === 0) continue;

    findings.push({
      gapType: 'entity_gap',
      severity: competitors.some((c) => c.presencePct >= 50) ? 'high' : 'medium',
      category,
      yourPresencePct,
      competitors,
    });
  }
  return findings;
}

export interface DomainCitationInput {
  competitorId: string;
  competitorName: string;
  /** Every cited domain, one entry per (query x provider) observation that
   * cited it — duplicates counted (this is a citation-frequency count, not
   * a distinct-domain set). */
  citedDomains: string[];
  /** The denominator: this competitor's run's total planned jobs
   * (`totalQueries x totalProviders`), matching `computeMentionScore`'s own
   * "queries x models," never-shrinks-on-failure denominator convention. */
  totalJobs: number;
}

/** Type 4 — "Trusted domains AI cites that contain no brand content."
 * Aggregate, across the whole query set: any domain a competitor's
 * responses cite that the brand's OWN responses never cite once. */
export function classifySourceGaps(yourCitedDomains: readonly string[], competitors: readonly DomainCitationInput[]): SourceGapFinding[] {
  const yourDomains = new Set(yourCitedDomains);
  const perDomain = new Map<string, SourceGapFinding['citedByCompetitors']>();

  for (const competitor of competitors) {
    if (competitor.totalJobs <= 0) continue;
    const counts = new Map<string, number>();
    for (const domain of competitor.citedDomains) counts.set(domain, (counts.get(domain) ?? 0) + 1);

    for (const [domain, count] of counts) {
      if (yourDomains.has(domain)) continue;
      const entry = perDomain.get(domain) ?? [];
      entry.push({
        competitorId: competitor.competitorId,
        competitorName: competitor.competitorName,
        citationRatePct: round2((100 * count) / competitor.totalJobs),
      });
      perDomain.set(domain, entry);
    }
  }

  const findings: SourceGapFinding[] = [];
  for (const [domain, citedByCompetitors] of perDomain) {
    const maxRate = Math.max(...citedByCompetitors.map((c) => c.citationRatePct));
    findings.push({ gapType: 'source_gap', severity: maxRate >= 25 ? 'high' : 'medium', domain, citedByCompetitors });
  }
  return findings;
}

// ── Movement alerts (comparison logic only — see this epic's spec: the
// schedule trigger is deferred to Epic 12's Competitor Agent). ──────────

export interface MovementResult {
  previousScore: number | null;
  latestScore: number | null;
  delta: number | null;
  direction: 'increase' | 'decrease' | 'flat' | null;
  /** "CompetitorA just increased their AI visibility by 15 points" —
   * `docs/09-ux/CUSTOMER_JOURNEY.md`'s retention-mechanic copy, verbatim
   * shape. `null` when there isn't yet a previous completed run to compare
   * against. */
  sentence: string | null;
}

export function computeCompetitorMovement(entityName: string, previousScore: number | null, latestScore: number | null): MovementResult {
  if (previousScore === null || latestScore === null) {
    return { previousScore, latestScore, delta: null, direction: null, sentence: null };
  }

  const delta = round2(latestScore - previousScore);
  const direction: MovementResult['direction'] = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'flat';
  const sentence =
    direction === 'flat'
      ? `${entityName}'s AI visibility is unchanged since the last run.`
      : `${entityName} just ${direction}d their AI visibility by ${Math.abs(delta)} points.`;

  return { previousScore, latestScore, delta, direction, sentence };
}

export { AVS_FORMULA_VERSION };
