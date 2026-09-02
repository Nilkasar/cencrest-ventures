/**
 * AI Visibility Score — formula v1.0, verbatim from
 * `docs/11-geo/GEO_ENGINE.md` / `docs/12-ai/AI_ARCHITECTURE.md`'s "GEO Query
 * Execution" AGGREGATE step, and the epic spec's own literal restatement
 * (`docs/epics/07-ai-visibility-engine.md`):
 *
 *   MentionScore        = mentioned / (queries x models) x 100
 *   RecommendationScore = (queries where brand is recommended) / queries x 100
 *   PositionScore       = average(1 - first_position) x 100
 *   CoverageScore       = intents_covered / total_intents x 100
 *   AVS = MentionScore*0.25 + RecommendationScore*0.40 + PositionScore*0.20 + CoverageScore*0.15
 *
 * Pure, deterministic, side-effect-free — no database, no AI provider, no
 * clock. `computeAiVisibilityScore` is the ONLY place this arithmetic
 * happens; `lib/ai-visibility/pipeline.ts` calls it once per run and stores
 * every field of the result, never recomputes a component independently.
 *
 * Two literal-text ambiguities in the source docs were resolved here,
 * documented so a future formula version change starts from the same
 * understanding:
 *
 * 1. "queries" in this codebase's schema means individual `queries` rows
 *    (docs/06-database/SCHEMA.md §3) — there is no separate "intent" entity
 *    distinct from a query (a query merely carries an `intent_type` tag).
 *    So CoverageScore's "intents_covered / total_intents" and
 *    RecommendationScore's "queries" both resolve to the same denominator:
 *    the count of DISTINCT queries in the run's query_set.
 * 2. GEO_ENGINE.md's RecommendationScore prose says "top-3-recommended,"
 *    but `docs/12-ai/AI_ARCHITECTURE.md`'s `BrandObservation` schema (which
 *    `brand_observations` is transcribed from field-for-field) has no
 *    numeric recommendation-RANK field — only a boolean `brandRecommended`
 *    plus a `strong`/`weak`/`implied` STRENGTH enum, neither of which
 *    encodes "was this the 1st/2nd/3rd item in a list." AI_ARCHITECTURE.md's
 *    own reference implementation
 *    (`computeRecommendationScore(responses)`) drops the "top-3" qualifier
 *    entirely and just counts `brandRecommended`. This implementation does
 *    the same: "recommended" is read as "the extraction pipeline judged the
 *    brand recommended," not "recommended within the top 3 of an explicit
 *    ranked list" — there is nothing in the extracted data that COULD
 *    distinguish the two. A future formula version could add a rank field
 *    to `brand_observations` and tighten this; v1.0 does not have one.
 *
 * GEO_ENGINE.md's own worked "evidence traceability" example (41/28/48/19 ->
 * "32") does not actually satisfy its own formula (41*0.25 + 28*0.40 +
 * 48*0.20 + 19*0.15 = 33.9, not 32) — the doc's arithmetic is wrong, not the
 * formula. This implementation follows the FORMULA as written, not the
 * doc's unreconcilable worked total; `scoring.test.ts` uses hand-verified
 * fixed inputs instead of transcribing that example.
 */

export const AVS_FORMULA_VERSION = '1.0';

/** The minimal shape `computeAiVisibilityScore` needs from a
 * `brand_observations` row — deliberately NOT the full Prisma model, so
 * this module never needs to import `@bebest/database` (kept pure/testable
 * with plain object literals). */
export interface ScoredObservation {
  queryId: string;
  brandMentioned: boolean;
  brandRecommended: boolean;
  /** Normalized 0 (start of response) .. 1 (end). `null` when not
   * mentioned (there is no "first position" to report). */
  brandFirstPosition: number | null;
}

export interface AiVisibilityScoreInput {
  observations: readonly ScoredObservation[];
  /** Total DISTINCT queries in the run's query_set — the fixed
   * denominator for RecommendationScore/CoverageScore, and (multiplied by
   * `totalProviders`) for MentionScore. NOT `observations.length` — a
   * failed job (provider error or extraction failure) produces no
   * observation, and per the literal formula text ("queries x models," not
   * "successful responses"), a failure still counts against the score
   * rather than being invisibly excluded from the denominator. */
  totalQueries: number;
  /** The number of providers this run fanned out to (docs/12-ai/
   * AI_ARCHITECTURE.md's `taskDefaults['geo.query']` — normally 4). */
  totalProviders: number;
}

export interface ComponentScores {
  mentionScore: number;
  recommendationScore: number;
  positionScore: number;
  coverageScore: number;
}

export interface AiVisibilityScoreResult extends ComponentScores {
  aiVisibilityScore: number;
  formulaVersion: string;
}

/** Rounds to 2 decimal places — every stored/returned score field uses
 * this exact rounding, so a caller recomputing `AVS` from the ALREADY
 * ROUNDED component fields (rather than from raw observations) reliably
 * gets back the same stored total; see `pipeline.ts` and
 * `routes/ai-run-details.ts`'s score endpoint. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeMentionScore(input: Pick<AiVisibilityScoreInput, 'observations' | 'totalQueries' | 'totalProviders'>): number {
  const denominator = input.totalQueries * input.totalProviders;
  if (denominator <= 0) return 0;
  const mentioned = input.observations.filter((o) => o.brandMentioned).length;
  return round2((mentioned / denominator) * 100);
}

export function computeRecommendationScore(input: Pick<AiVisibilityScoreInput, 'observations' | 'totalQueries'>): number {
  if (input.totalQueries <= 0) return 0;
  const recommendedQueries = new Set(
    input.observations.filter((o) => o.brandRecommended).map((o) => o.queryId),
  );
  return round2((recommendedQueries.size / input.totalQueries) * 100);
}

export function computePositionScore(observations: readonly ScoredObservation[]): number {
  const withPosition = observations.filter(
    (o): o is ScoredObservation & { brandFirstPosition: number } => o.brandFirstPosition !== null,
  );
  if (withPosition.length === 0) return 0;
  const avgWeight =
    withPosition.reduce((sum, o) => sum + (1 - o.brandFirstPosition), 0) / withPosition.length;
  return round2(avgWeight * 100);
}

export function computeCoverageScore(input: Pick<AiVisibilityScoreInput, 'observations' | 'totalQueries'>): number {
  if (input.totalQueries <= 0) return 0;
  const coveredQueries = new Set(
    input.observations.filter((o) => o.brandMentioned).map((o) => o.queryId),
  );
  return round2((coveredQueries.size / input.totalQueries) * 100);
}

/**
 * The single entry point every caller (the pipeline's AGGREGATE step, and
 * any future re-scoring tool) should use — computes all four components
 * AND the composite from the same input in one call, so it is never
 * possible to compute one component from a different observation set than
 * another. `aiVisibilityScore` is derived from the ALREADY-ROUNDED
 * component scores (not from raw observations a second time), which is
 * what guarantees `mentionScore*0.25 + recommendationScore*0.40 +
 * positionScore*0.20 + coverageScore*0.15 === aiVisibilityScore` holds
 * exactly for every result this function returns — the evidence-
 * traceability invariant `GET /ai-runs/:id/score` promises.
 */
export function computeAiVisibilityScore(input: AiVisibilityScoreInput): AiVisibilityScoreResult {
  const mentionScore = computeMentionScore(input);
  const recommendationScore = computeRecommendationScore(input);
  const positionScore = computePositionScore(input.observations);
  const coverageScore = computeCoverageScore(input);

  const aiVisibilityScore = round2(
    mentionScore * 0.25 + recommendationScore * 0.4 + positionScore * 0.2 + coverageScore * 0.15,
  );

  return { mentionScore, recommendationScore, positionScore, coverageScore, aiVisibilityScore, formulaVersion: AVS_FORMULA_VERSION };
}
