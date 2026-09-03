/**
 * SEO Opportunity Score — formula v1.0, `docs/10-seo/SEO_ENGINE.md`
 * ("SEO OPPORTUNITY SCORING"), verbatim:
 *
 *   Value = demand_score × (1 - current_coverage)
 *   Effort = content_complexity × technical_difficulty   (0-100)
 *   Opportunity Score = (Value × 0.7) + (Value / Effort × 0.3), normalized to 0-100
 *
 * Do not alter this without a version bump (`SCORING_FORMULA_VERSION`) per
 * the epic spec's explicit instruction — every stored row keeps the version
 * it was actually computed under, so a future v1.1 never silently
 * reinterprets historical rows.
 *
 * ── Two ambiguities in the doc's prose, resolved here (documented, not
 * silently guessed) ──
 *
 * 1. **Effort's declared 0-100 range.** `content_complexity` and
 *    `technical_difficulty` are both independently 0-100 scores (the doc's
 *    own convention for every other score in this system). A direct product
 *    of two 0-100 numbers ranges 0-10,000, not 0-100 as the formula's own
 *    parenthetical says. Read literally, the only way both statements are
 *    true is that the product is scaled back down by the same factor one of
 *    the inputs is out of 100 — i.e. `effort = (content_complexity *
 *    technical_difficulty) / 100`. This is the standard "percentage of a
 *    percentage" normalization and is what `computeEffort` below
 *    implements.
 * 2. **Division by (near-)zero effort.** `Value / Effort` is undefined at
 *    `effort = 0` (trivial content, trivial technical difficulty — a
 *    genuinely possible input). Guarded with a tiny epsilon floor
 *    (`MIN_EFFORT_DENOMINATOR`) purely to keep the arithmetic finite, not to
 *    change any result at normal input scales; the final `normalized to
 *    0-100` clamp (`clampScore`) is what actually bounds the few
 *    near-zero-effort cases that would otherwise blow past 100.
 */

export const SCORING_FORMULA_VERSION = '1.0';

export interface OpportunityScoringInput {
  /** 0-100 — normalized search volume or estimated intent strength. */
  demandScore: number;
  /** 0-1 — how well the brand currently serves this intent. */
  currentCoverage: number;
  /** 0-100. */
  contentComplexity: number;
  /** 0-100. */
  technicalDifficulty: number;
}

export interface OpportunityScoringResult {
  valueScore: number;
  effortScore: number;
  opportunityScore: number;
  formulaVersion: typeof SCORING_FORMULA_VERSION;
}

/** Exported so Epic 9's Opportunity Engine merge (`lib/opportunities/
 * merge-scoring.ts`) can apply the identical epsilon floor when it
 * re-runs this formula's own weighted-combination shape over an already-
 * computed pair of standalone (SEO, GEO) results, rather than inventing a
 * second, slightly different floor value. */
export const MIN_EFFORT_DENOMINATOR = 1e-6;

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Rounds to 2 decimal places — matches the `Decimal(5, 2)` storage column. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeValue(demandScore: number, currentCoverage: number): number {
  return clampScore(demandScore * (1 - currentCoverage));
}

/** See this file's header comment #1 for why this divides by 100. */
export function computeEffort(contentComplexity: number, technicalDifficulty: number): number {
  return clampScore((contentComplexity * technicalDifficulty) / 100);
}

/**
 * The full formula v1.0 pipeline. Every intermediate (`valueScore`,
 * `effortScore`) is returned alongside the final `opportunityScore` because
 * `seo_opportunities.value_score`/`effort_score` are their own persisted
 * columns (the epic spec's literal field list) — callers should not
 * recompute them separately from `computeValue`/`computeEffort` and risk
 * the two calls drifting from what actually got stored.
 */
export function computeOpportunityScore(input: OpportunityScoringInput): OpportunityScoringResult {
  const valueScore = computeValue(input.demandScore, input.currentCoverage);
  const effortScore = computeEffort(input.contentComplexity, input.technicalDifficulty);
  const effortDenominator = Math.max(effortScore, MIN_EFFORT_DENOMINATOR);

  const raw = valueScore * 0.7 + (valueScore / effortDenominator) * 0.3;

  return {
    valueScore: round2(valueScore),
    effortScore: round2(effortScore),
    opportunityScore: round2(clampScore(raw)),
    formulaVersion: SCORING_FORMULA_VERSION,
  };
}
