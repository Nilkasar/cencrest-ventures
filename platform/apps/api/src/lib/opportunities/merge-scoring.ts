/**
 * Epic 9 (Opportunity Engine) — pure, deterministic merge math. Every
 * export here is side-effect-free (no database, no AI provider, no clock),
 * same discipline `lib/ai-visibility/scoring.ts`/`lib/ai-visibility/
 * competitive.ts` use for the identical reason: the formula boundaries
 * (idempotent re-run, "unified must score higher than either signal
 * alone," material-change detection) are proven by unit tests against
 * plain object literals, not by exercising the whole route.
 * `routes/opportunities.ts` is the only caller — it loads real data via
 * Epic 4's `seo_keywords`/`seo_opportunities` and Epic 8's
 * `loadCompetitiveDataset`/`classifyIntentGaps`, maps Prisma rows into the
 * small shapes below, and calls these functions. It does NOT reimplement
 * Epic 4's or Epic 8's own scoring — `computeOpportunityScore` (Epic 4) and
 * `classifyIntentGaps`/`computeQueryStats`/`buildQueryComparisonSentence`
 * (Epic 8) are imported and called directly.
 *
 * ── The merge formula, spelled out ──────────────────────────────────────
 *
 * For `seo`- or `geo`-only intents, this module calls Epic 4's own
 * `computeOpportunityScore` exactly once, with `currentCoverage: 0` (Epic
 * 4's own fresh-keyword default — no page-to-keyword mapping exists yet,
 * see `keyword-to-opportunity.ts`'s header comment; when a GEO signal is
 * present, `classifyIntentGaps` only ever fires for a query where the
 * brand's own mention rate is exactly 0, so 0 is exactly correct there
 * too) and reports its `valueScore`/`effortScore`/`opportunityScore`
 * straight through as `impactScore`/`effortScore`/`opportunityScore`.
 *
 * For `unified` intents (both signals present), the two signals are each
 * run through `computeOpportunityScore` independently first (the
 * "standalone" SEO-only and GEO-only results a `seo`/`geo`-typed
 * opportunity for the SAME intent would have gotten), then combined:
 *
 * 1. `impactScore = combineSignals(seoStandalone.valueScore,
 *    geoStandalone.valueScore)` — a probabilistic-OR combination
 *    (`100 - (1 - a/100)(1 - b/100) * 100`), not a sum. Two properties this
 *    depends on:
 *      - When only one signal is present (the other `null` -> treated as
 *        0), the combined value equals that signal exactly.
 *      - When both are present and each < 100, the combined value is
 *        STRICTLY greater than either alone, and never exceeds 100 —
 *        without the double-counting a plain sum would risk (a query that
 *        is both high-SEO-demand AND high-GEO-gap is not "twice as
 *        important," it is one opportunity with two lines of evidence for
 *        it).
 * 2. `effortScore = min(seoStandalone.effortScore,
 *    geoStandalone.effortScore)` — the LOWER of the two, not the higher and
 *    not an average. This is the deliberate product judgment the epic spec
 *    asks for ("define [GEO effort] ... documented and versioned"): the
 *    epic's own pitch (`PRODUCT_VISION.md`'s "Pillar 3") is that ONE
 *    content asset can close both gaps at once, so a unified opportunity
 *    must never be modeled as requiring MORE effort than doing the easier
 *    of the two alone — that would penalize the exact synergy the merge is
 *    supposed to reward.
 * 3. `opportunityScore` re-applies Epic 4's own weighted-combination SHAPE
 *    (`Value*0.7 + (Value/Effort)*0.3`, clamped 0-100, same
 *    `MIN_EFFORT_DENOMINATOR` epsilon floor Epic 4 exports for exactly this
 *    reuse) to the combined `impactScore`/`effortScore` above — it does not
 *    call `computeOpportunityScore` a third time with invented complexity
 *    inputs (there is no single "content complexity" that would honestly
 *    reproduce an already-`min`-combined effort), it applies the same
 *    published formula shape directly to values `computeOpportunityScore`
 *    itself already produced.
 *
 * Because step 1 never produces a SMALLER impact than either standalone
 * value, and step 2 never produces a LARGER effort than either standalone
 * value, `opportunityScore` for `unified` is mathematically guaranteed to
 * be `>= max(seoStandalone.opportunityScore, geoStandalone.opportunityScore)`
 * under the same monotonic formula shape — with equality possible only at
 * the genuine ceiling (both standalone scores already at the 0-100 clamp
 * with identical effort), which is the correct, honest answer in that edge
 * case, not a bug: a signal that is already scored at the maximum cannot be
 * pushed higher by discovering a second one.
 */
import {
  buildQueryComparisonSentence,
  type GapSeverity,
  type IntentGapFinding,
  type QueryStats,
} from '../ai-visibility/competitive.js';
import { contentComplexityForIntent, DEFAULT_TECHNICAL_DIFFICULTY, normalizeDemandScore } from '../seo/keyword-to-opportunity.js';
import { computeOpportunityScore, MIN_EFFORT_DENOMINATOR } from '../seo/opportunity-scoring.js';
import type { keyword_intent } from '@bebest/database';

export const OPPORTUNITY_ENGINE_FORMULA_VERSION = '1.0';

export type MergeOpportunityType = 'seo' | 'geo' | 'unified';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// ── Signal combination ──────────────────────────────────────────────────

/** See this file's header comment #1. `null` is treated as "no signal"
 * (0), not "worst possible" — a missing signal must never itself drag the
 * combined score down. */
export function combineSignals(a: number | null, b: number | null): number {
  const x = clampScore(a ?? 0);
  const y = clampScore(b ?? 0);
  return round2(100 - ((100 - x) / 100) * ((100 - y) / 100) * 100);
}

// ── GEO-side inputs (this epic's own, documented v1 judgment calls —
// Epic 8 has no "effort" or "demand" concept of its own to reuse here,
// only the gap classification + mention-rate stats). ────────────────────

/** Citation-building/authority work implied by how severe the gap is —
 * `docs/11-geo/GEO_ENGINE.md` has no literal "GEO effort" formula to
 * transcribe (this epic's spec explicitly asks for one to be "defined and
 * versioned like every other formula here"), so this is this epic's own
 * v1 mapping: a `high`-severity gap (a competitor dominant at >=50%
 * mention rate — see `classifyIntentGaps`) implies more citation-building
 * work than a `medium` one. `low` is defensively included even though
 * `classifyIntentGaps` never currently emits it. */
const GEO_CONTENT_COMPLEXITY_BY_SEVERITY: Record<GapSeverity, number> = {
  high: 70,
  medium: 50,
  low: 30,
};

export function geoContentComplexity(severity: GapSeverity): number {
  return GEO_CONTENT_COMPLEXITY_BY_SEVERITY[severity];
}

/** The GEO gap's own magnitude, 0-100: the best-performing competitor's
 * mention rate for this query. `classifyIntentGaps` only ever produces a
 * finding when the brand's own mention rate is 0, so "competitor rate minus
 * your rate" and "competitor rate" are the same number here — documented
 * rather than silently assuming the reader knows that invariant. */
export function geoGapScoreFromFinding(finding: IntentGapFinding): number {
  return round2(Math.max(...finding.competitors.map((c) => c.mentionRatePct)));
}

// ── Type classification ─────────────────────────────────────────────────

export function classifyMergeType(seoPresent: boolean, geoPresent: boolean): MergeOpportunityType | null {
  if (seoPresent && geoPresent) return 'unified';
  if (seoPresent) return 'seo';
  if (geoPresent) return 'geo';
  return null;
}

// ── Full per-intent scoring pipeline ─────────────────────────────────────

export interface SeoSignalInput {
  keywordId: string;
  keywordText: string;
  monthlyVolume: number | null;
  difficulty: number | null;
  intent: keyword_intent | null;
  /** The matched `seo_opportunities` row's own `value_score`, when one
   * exists (created at `POST /keyword-groups/generate` time) — preferred
   * over recomputing from scratch so this epic reports the SAME demand
   * number Epic 4's own UI already shows for this keyword. `null` when the
   * keyword was added manually with no generated opportunity yet, in which
   * case `normalizeDemandScore` (Epic 4's own function) is used instead. */
  matchedOpportunityId: string | null;
  matchedOpportunityValueScore: number | null;
}

export interface GeoSignalInput {
  finding: IntentGapFinding;
  /** One (competitorId, competitorRunId, sentence) tuple per competitor
   * contributing to the finding — already built via
   * `buildQueryComparisonSentence` by the caller, since that also needs
   * `yourStats`/each competitor's `QueryStats`, which this module has no
   * business re-deriving. */
  competitorEvidence: Array<{ competitorId: string; competitorName: string; competitorRunId: string; mentionRatePct: number; sentence: string }>;
}

export interface MergeInput {
  queryId: string;
  queryText: string;
  seo: SeoSignalInput | null;
  geo: GeoSignalInput | null;
}

export interface EvidenceInput {
  sourceTable: string;
  sourceId: string;
  summary: string;
  rawData: Record<string, unknown>;
}

export interface MergeResult {
  type: MergeOpportunityType;
  title: string;
  seoDemandScore: number | null;
  geoGapScore: number | null;
  effortScore: number;
  impactScore: number;
  opportunityScore: number;
  formulaVersion: typeof OPPORTUNITY_ENGINE_FORMULA_VERSION;
  priority: 1 | 2 | 3;
  evidence: EvidenceInput[];
}

/** 1=high/2=medium/3=low — same "documented v1 threshold, not a value from
 * any source doc" treatment `keyword-to-opportunity.ts`'s own mappings get. */
export function priorityFromScore(opportunityScore: number): 1 | 2 | 3 {
  if (opportunityScore >= 60) return 1;
  if (opportunityScore >= 30) return 2;
  return 3;
}

function seoDemandScoreFor(seo: SeoSignalInput): number {
  return seo.matchedOpportunityValueScore ?? normalizeDemandScore(seo.monthlyVolume);
}

function titleFor(type: MergeOpportunityType, queryText: string): string {
  if (type === 'unified') return `Unify SEO + AI visibility for "${queryText}"`;
  if (type === 'seo') return `Target "${queryText}"`;
  return `Close the AI visibility gap for "${queryText}"`;
}

function buildSeoEvidence(seo: SeoSignalInput, seoDemandScore: number): EvidenceInput {
  const volumeClause =
    seo.monthlyVolume === null
      ? `no search-volume data yet (estimated demand score ${seoDemandScore})`
      : `an estimated ${seo.monthlyVolume} monthly searches`;
  return {
    sourceTable: 'seo_keywords',
    sourceId: seo.keywordId,
    summary: `"${seo.keywordText}" gets ${volumeClause}.`,
    rawData: {
      keywordId: seo.keywordId,
      keywordText: seo.keywordText,
      monthlyVolume: seo.monthlyVolume,
      difficulty: seo.difficulty,
      intent: seo.intent,
      matchedOpportunityId: seo.matchedOpportunityId,
      seoDemandScore,
    },
  };
}

function buildGeoEvidence(geo: GeoSignalInput, queryId: string, queryText: string): EvidenceInput[] {
  return geo.competitorEvidence.map((c) => ({
    sourceTable: 'ai_runs',
    sourceId: c.competitorRunId,
    summary: c.sentence,
    rawData: {
      queryId,
      queryText,
      competitorId: c.competitorId,
      competitorName: c.competitorName,
      competitorMentionRatePct: c.mentionRatePct,
      yourMentionRatePct: geo.finding.yourMentionRatePct,
    },
  }));
}

/** Applies Epic 4's exact `Value*0.7 + (Value/Effort)*0.3` shape (and its
 * exported epsilon floor) to already-computed impact/effort numbers — see
 * this file's header comment #3 for why this is a direct application of
 * the published formula, not a second implementation of it. */
function applyOpportunityFormulaShape(impactScore: number, effortScore: number): number {
  const denominator = Math.max(effortScore, MIN_EFFORT_DENOMINATOR);
  return round2(clampScore(impactScore * 0.7 + (impactScore / denominator) * 0.3));
}

/** Returns `null` when neither signal is present — the caller must not
 * create (or keep updating) an opportunity row for an intent with zero
 * evidence behind it (this epic's merge-logic bullet 3: "an intent with
 * only one signal present is still valid..." implies the zero-signal case
 * is simply not an opportunity at all). */
export function buildMergeResult(input: MergeInput): MergeResult | null {
  const type = classifyMergeType(input.seo !== null, input.geo !== null);
  if (type === null) return null;

  const technicalDifficulty = input.seo?.difficulty ?? DEFAULT_TECHNICAL_DIFFICULTY;

  const seoStandalone = input.seo
    ? computeOpportunityScore({
        demandScore: seoDemandScoreFor(input.seo),
        currentCoverage: 0,
        contentComplexity: contentComplexityForIntent(input.seo.intent),
        technicalDifficulty,
      })
    : null;
  const geoStandalone = input.geo
    ? computeOpportunityScore({
        demandScore: geoGapScoreFromFinding(input.geo.finding),
        currentCoverage: 0,
        contentComplexity: geoContentComplexity(input.geo.finding.severity),
        technicalDifficulty,
      })
    : null;

  const seoDemandScore = input.seo ? seoDemandScoreFor(input.seo) : null;
  const geoGapScore = input.geo ? geoGapScoreFromFinding(input.geo.finding) : null;

  let effortScore: number;
  let impactScore: number;
  let opportunityScore: number;

  if (type === 'unified') {
    // Both are non-null when type === 'unified' (classifyMergeType requires
    // both signals present).
    impactScore = combineSignals(seoStandalone!.valueScore, geoStandalone!.valueScore);
    effortScore = round2(Math.min(seoStandalone!.effortScore, geoStandalone!.effortScore));
    opportunityScore = applyOpportunityFormulaShape(impactScore, effortScore);
  } else if (type === 'seo') {
    impactScore = seoStandalone!.valueScore;
    effortScore = seoStandalone!.effortScore;
    opportunityScore = seoStandalone!.opportunityScore;
  } else {
    impactScore = geoStandalone!.valueScore;
    effortScore = geoStandalone!.effortScore;
    opportunityScore = geoStandalone!.opportunityScore;
  }

  const evidence: EvidenceInput[] = [
    ...(input.seo ? [buildSeoEvidence(input.seo, seoDemandScore!)] : []),
    ...(input.geo ? buildGeoEvidence(input.geo, input.queryId, input.queryText) : []),
  ];

  return {
    type,
    title: titleFor(type, input.queryText),
    seoDemandScore,
    geoGapScore,
    effortScore,
    impactScore,
    opportunityScore,
    formulaVersion: OPPORTUNITY_ENGINE_FORMULA_VERSION,
    priority: priorityFromScore(opportunityScore),
    evidence,
  };
}

// ── Idempotent re-run: material-change detection for a dismissed row ────

/** How much `opportunity_score` must move (in either direction) before a
 * DISMISSED opportunity is considered to have "materially changed" and is
 * un-dismissed back to `new` on the next recompute — this epic's spec
 * explicitly asks for this threshold to be "defined and documented," not
 * left implicit. 15 points is a v1 judgment call (roughly one score
 * bucket's width — see `priorityFromScore`'s 30/60 thresholds), not a value
 * taken from any source doc. A `type` change (e.g. `seo` -> `unified`) is
 * ALWAYS material, regardless of score delta — the qualitative signal set
 * changed, not just its magnitude. */
export const MATERIAL_CHANGE_SCORE_DELTA = 15;

export function isMaterialChange(
  previous: { type: string; opportunityScore: number },
  next: { type: MergeOpportunityType; opportunityScore: number },
): boolean {
  if (previous.type !== next.type) return true;
  return Math.abs(next.opportunityScore - previous.opportunityScore) >= MATERIAL_CHANGE_SCORE_DELTA;
}

export { buildQueryComparisonSentence };
export type { GapSeverity, IntentGapFinding, QueryStats };
