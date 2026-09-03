/**
 * Epic 14 (Measurement & Learning Loop) — the pure, deterministic delta
 * calculation the spec requires ("Delta calculation must be a pure,
 * testable function of (before_score, after_score) with deterministic,
 * unit-tested output"). No database, no AI provider, no clock — same
 * "pure, side-effect-free" discipline `lib/ai-visibility/scoring.ts`'s
 * `computeAiVisibilityScore` and `lib/seo/opportunity-scoring.ts`'s
 * `computeOpportunityScore` already establish for every other scoring
 * formula in this codebase.
 *
 * `ScoreSnapshot` is the shared shape both `before_score` and `after_score`
 * are stored in (`measurements.before_score`/`.after_score`, both JSONB) —
 * a GEO component (Epic 7's real `ai_visibility_score` + its four
 * components, read back verbatim, never recomputed) and/or a SEO component
 * (an aggregation OVER Epic 4's real per-page `seo_analyses.score` values —
 * see `current-score-snapshot.ts`'s own header comment for why the
 * aggregation itself is new but every score it aggregates is 100% Epic 4's
 * own output). Either can independently be `null` when that signal has no
 * data at all for this brand yet — never coerced to a misleading 0, same
 * "null means no data, not zero" convention `unified_opportunities.
 * seo_demand_score`/`.geo_gap_score` already use.
 */

export interface GeoScoreComponent {
  aiRunId: string;
  aiVisibilityScore: number;
  mentionScore: number;
  recommendationScore: number;
  positionScore: number;
  coverageScore: number;
  formulaVersion: string;
  /** ISO 8601 — when the `ai_runs` row this component came from actually
   * completed (`ai_runs.completed_at`), not when this snapshot was taken. */
  measuredAt: string;
}

export interface SeoScoreComponent {
  overallScore: number;
  technicalScore: number | null;
  contentScore: number | null;
  pagesAnalyzed: number;
  /** Labels the AGGREGATION method (this epic's own — averaging Epic 4's
   * already-computed per-page/content `seo_analyses.score` values), never a
   * new page-level scoring formula version. See `current-score-snapshot.ts`. */
  formulaVersion: string;
  /** ISO 8601 — the most recent `seo_analyses.analyzed_at` among the rows
   * this component aggregated. */
  measuredAt: string;
}

export interface ScoreSnapshot {
  geo: GeoScoreComponent | null;
  seo: SeoScoreComponent | null;
  /** ISO 8601 — when this snapshot itself was assembled (approval time for
   * `before_score`, re-measurement time for `after_score`). Distinct from
   * either component's own `measuredAt`, which can be OLDER than
   * `capturedAt` for `before_score` (a snapshot of the latest ALREADY-
   * COMPUTED data, not a freshly triggered run — see this epic's backend
   * doc for the reasoning). */
  capturedAt: string;
}

export type ScoreDeltaBasis = 'geo' | 'seo' | 'none';

export interface ScoreDeltaResult {
  /** Rounded to 2 decimal places, `after - before` on whichever basis was
   * used. `null` when neither side has a comparable component at all. */
  delta: number | null;
  /** Which component the delta was computed from. GEO is preferred over SEO
   * when both are available — see this file's `computeScoreDelta` doc
   * comment for why. */
  basis: ScoreDeltaBasis;
  /** Whether before/after used the identical scoring_formula_version for
   * the chosen basis. `null` when `basis === 'none'` (nothing to compare
   * versions of). A future formula version bump makes this `false` for any
   * measurement spanning the change — surfaced so attribution can be
   * appropriately less confident, never silently ignored. */
  formulaVersionsMatch: boolean | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The single entry point for comparing a `before_score`/`after_score` pair.
 * GEO (`aiVisibilityScore`) is preferred over SEO whenever both sides have
 * a GEO component: AI visibility is this product's headline metric (the
 * tagline this whole build exists for — "did AI recommend you") and Epic
 * 7's pipeline is what the 4-week re-measurement trigger ALWAYS attempts to
 * re-run (see `run-measurement.ts`); SEO re-analysis is attempted whenever
 * the brand has crawl data, but is the fallback basis when GEO has no
 * comparable pair (no active query set, or an entitlement limit blocked the
 * re-run — see `attribution.ts`'s `freshRerun` flag for how that case is
 * flagged as lower-confidence rather than silently swapping bases without a
 * trace).
 */
export function computeScoreDelta(before: ScoreSnapshot, after: ScoreSnapshot): ScoreDeltaResult {
  if (before.geo && after.geo) {
    return {
      delta: round2(after.geo.aiVisibilityScore - before.geo.aiVisibilityScore),
      basis: 'geo',
      formulaVersionsMatch: before.geo.formulaVersion === after.geo.formulaVersion,
    };
  }
  if (before.seo && after.seo) {
    return {
      delta: round2(after.seo.overallScore - before.seo.overallScore),
      basis: 'seo',
      formulaVersionsMatch: before.seo.formulaVersion === after.seo.formulaVersion,
    };
  }
  return { delta: null, basis: 'none', formulaVersionsMatch: null };
}
