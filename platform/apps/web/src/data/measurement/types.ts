/**
 * Epic 14 — Measurement & Learning Loop domain model.
 *
 * Mirrors `apps/api/src/lib/measurement/{scoring,serialize}.ts` and
 * `routes/{measurements,action-measurement}.ts` field-for-field (read the
 * actual backend source directly, not this epic's docs — the standing rule
 * on this project). Every field is camelCase because the API already
 * returns a camelCase, whitelisted object, same "comes across as-is"
 * convention `data/actions/types.ts`/`data/ai-visibility/types.ts` already
 * establish.
 */

/** `measurements.attribution_confidence` — reuses the backend's own
 *  `claim_confidence` enum (`high|medium|low`), the identical vocabulary
 *  `data/seo/types.ts`'s `SeoKeywordConfidence` (minus its `estimate`
 *  variant) and `data/ai-visibility/types.ts`'s `ExtractionConfidence`
 *  already use for "how much should a reader trust this derived value." */
export type AttributionConfidence = "high" | "medium" | "low";

/** `lib/measurement/scoring.ts`'s `GeoScoreComponent` — Epic 7's real
 *  `ai_visibility_score` and its four components, read back verbatim from
 *  the `ai_runs` row that produced them, never recomputed here. */
export interface GeoScoreComponent {
  aiRunId: string;
  aiVisibilityScore: number;
  mentionScore: number;
  recommendationScore: number;
  positionScore: number;
  coverageScore: number;
  formulaVersion: string;
  /** ISO 8601 — when the underlying `ai_runs` row completed, not when this
   *  snapshot was taken. */
  measuredAt: string;
}

/** `lib/measurement/scoring.ts`'s `SeoScoreComponent` — an aggregation OVER
 *  Epic 4's real per-page/content `seo_analyses.score` values (averaged
 *  across the brand's pages); `formulaVersion` labels this AGGREGATION
 *  method, not a new page-level scoring formula. */
export interface SeoScoreComponent {
  overallScore: number;
  technicalScore: number | null;
  contentScore: number | null;
  pagesAnalyzed: number;
  formulaVersion: string;
  /** ISO 8601 — the most recent `seo_analyses.analyzed_at` among the rows
   *  aggregated into this component. */
  measuredAt: string;
}

/** The shared before/after shape (`measurements.before_score`/
 *  `.after_score`, both JSONB) — either component can independently be
 *  `null` when that signal has no data at all for this brand, never coerced
 *  to a misleading 0. */
export interface ScoreSnapshot {
  geo: GeoScoreComponent | null;
  seo: SeoScoreComponent | null;
  /** ISO 8601 — when this snapshot itself was assembled: approval time for
   *  `beforeScore`, re-measurement time for `afterScore`. Can be OLDER than
   *  either component's own `measuredAt` for `beforeScore` (a snapshot of
   *  the latest already-computed data, not a freshly triggered run). */
  capturedAt: string;
}

/** Which component `computeScoreDelta` actually compared — GEO (AI
 *  visibility) is preferred over SEO whenever both sides have a GEO
 *  component; `"none"` when neither side has anything comparable. */
export type ScoreDeltaBasis = "geo" | "seo" | "none";

/** `lib/measurement/serialize.ts`'s `serializeMeasurement` — the shape
 *  shared verbatim by both `GET /brands/me/measurements` (list) and
 *  `GET /actions/:id/measurement` (single, once measured). */
export interface Measurement {
  id: string;
  actionId: string;
  brandId: string;
  beforeScore: ScoreSnapshot;
  beforeScoreCapturedAt: string;
  afterScore: ScoreSnapshot;
  afterAiRunId: string | null;
  /** `null` only when neither side had a comparable GEO or SEO component at
   *  all — never coerced to 0. */
  scoreDelta: number | null;
  /** Never presented as more certain than it is (this epic's non-negotiable
   *  #4) — always rendered paired with `attributionNotes`' plain-language
   *  estimate wording, never alone as if it were a verdict. */
  attributionConfidence: AttributionConfidence;
  attributionNotes: string;
  measuredAt: string;
  createdAt: string;
}

/** `GET /actions/:id/measurement`'s "not measured yet" shape — always 200,
 *  same "poll like run status" precedent `GET /ai-runs/:id/score` already
 *  sets (`AiRunScore`'s `computed: false`). */
export interface UnmeasuredActionSummary {
  id: string;
  status: string;
  executedAt: string | null;
  beforeScoreCapturedAt: string | null;
}

export type ActionMeasurementResponse =
  | { measured: false; action: UnmeasuredActionSummary }
  | { measured: true; measurement: Measurement };

/** `GET /brands/me/measurements` — sorted `measuredAt` desc, paginated. */
export interface MeasurementsListResponse {
  items: Measurement[];
  total: number;
  limit: number;
  offset: number;
}
