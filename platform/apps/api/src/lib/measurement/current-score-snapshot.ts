/**
 * Epic 14 (Measurement & Learning Loop) — reads the brand's CURRENT
 * (already-computed, not freshly re-run) AI-visibility/SEO scores, per
 * Epic 7's/Epic 4's own real scoring output. This is what `POST
 * /actions/:id/approve` calls to capture the immutable `before_score`
 * snapshot (this epic's whole non-negotiable) — deliberately a READ of
 * whatever is already stored, never a trigger of a brand-new AI run or
 * crawl (that would make every approval slow, expensive, and consume real
 * AI-query quota just to record a baseline). Re-measurement's `after_score`
 * (`run-measurement.ts`) is different in kind: it genuinely RE-RUNS Epic
 * 7's pipeline / Epic 4's checklist functions, then reads the result back
 * through the exact same aggregation this file performs, so before/after
 * are always shaped identically.
 *
 * GEO: the brand's most recently COMPLETED `ai_runs` row (Epic 7,
 * `competitor_id: null` — this brand's own visibility, never a competitor
 * run) — every field read back verbatim, zero recomputation.
 *
 * SEO: Epic 4 never defined a single brand-wide SEO score (only a
 * per-page/per-content `seo_analyses.score`, see `lib/seo/technical-
 * checklist.ts`). This function averages the LATEST stored score per page
 * (Prisma `distinct: ['page_id']` ordered by `analyzed_at desc` — one row
 * per page, the most recent) plus the latest content-level score. The
 * AGGREGATION (averaging across pages) is new to this epic; every number it
 * averages is 100% Epic 4's own `runTechnicalChecklist`/`runContentChecklist`
 * output, never recomputed here — `SEO_SNAPSHOT_AGGREGATION_VERSION` labels
 * this aggregation method itself (not a page-level scoring formula), so a
 * future change to HOW pages are combined into one brand score is a
 * documented version bump, same versioning discipline every other formula
 * in this codebase follows.
 */
import { withOrgContext, type ai_runs } from '@bebest/database';
import { AVS_FORMULA_VERSION } from '../ai-visibility/scoring.js';
import type { GeoScoreComponent, ScoreSnapshot, SeoScoreComponent } from './scoring.js';

export const SEO_SNAPSHOT_AGGREGATION_VERSION = '1.0';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Shapes one COMPLETED `ai_runs` row into a `GeoScoreComponent` — shared by
 * this file's own "latest known" read below and by `run-measurement.ts`'s
 * "just finished a fresh re-run" read, so a run is turned into this shape
 * in exactly one place regardless of which caller is asking. `null` for a
 * run that has not finished AGGREGATE yet (`ai_visibility_score` still
 * null) — same "no data yet, never a misleading 0" convention every other
 * nullable score in this codebase follows.
 */
export function toGeoScoreComponent(run: ai_runs): GeoScoreComponent | null {
  if (run.ai_visibility_score === null) return null;
  return {
    aiRunId: run.id,
    aiVisibilityScore: Number(run.ai_visibility_score),
    mentionScore: run.mention_score === null ? 0 : Number(run.mention_score),
    recommendationScore: run.recommendation_score === null ? 0 : Number(run.recommendation_score),
    positionScore: run.position_score === null ? 0 : Number(run.position_score),
    coverageScore: run.coverage_score === null ? 0 : Number(run.coverage_score),
    formulaVersion: run.scoring_formula_version ?? AVS_FORMULA_VERSION,
    measuredAt: (run.completed_at ?? run.created_at).toISOString(),
  };
}

/**
 * The averaging step both this file's `getCurrentScoreSnapshot` (reading
 * already-stored rows) and `reanalyze-seo.ts` (reading rows it just wrote)
 * share — factored out so the aggregation math exists in exactly one place.
 * `technicalScores` should already be "latest score per page" (never every
 * historical row for a page, which would double-count re-analyzed pages);
 * see this file's header comment for why averaging pages is this epic's own
 * addition, never a new PAGE-level scoring formula.
 */
export function aggregateSeoComponent(input: {
  technicalScores: number[];
  contentScore: number | null;
  measuredAtCandidates: Date[];
  pagesAnalyzed: number;
}): SeoScoreComponent | null {
  const technicalScore =
    input.technicalScores.length > 0 ? round2(input.technicalScores.reduce((a, b) => a + b, 0) / input.technicalScores.length) : null;

  const components = [technicalScore, input.contentScore].filter((s): s is number => s !== null);
  const overallScore = components.length > 0 ? round2(components.reduce((a, b) => a + b, 0) / components.length) : null;
  const measuredAt = input.measuredAtCandidates.length > 0 ? new Date(Math.max(...input.measuredAtCandidates.map((d) => d.getTime()))).toISOString() : null;

  if (overallScore === null || measuredAt === null) return null;

  return {
    overallScore,
    technicalScore,
    contentScore: input.contentScore,
    pagesAnalyzed: input.pagesAnalyzed,
    formulaVersion: SEO_SNAPSHOT_AGGREGATION_VERSION,
    measuredAt,
  };
}

export async function getCurrentScoreSnapshot(organizationId: string, brandId: string): Promise<ScoreSnapshot> {
  const [latestRun, technicalRows, contentRow] = await withOrgContext(organizationId, (tx) =>
    Promise.all([
      tx.ai_runs.findFirst({
        where: { organization_id: organizationId, brand_id: brandId, competitor_id: null, status: 'completed' },
        orderBy: { completed_at: 'desc' },
      }),
      tx.seo_analyses.findMany({
        where: { organization_id: organizationId, brand_id: brandId, analysis_type: 'technical' },
        orderBy: { analyzed_at: 'desc' },
        distinct: ['page_id'],
      }),
      tx.seo_analyses.findFirst({
        where: { organization_id: organizationId, brand_id: brandId, analysis_type: 'content' },
        orderBy: { analyzed_at: 'desc' },
      }),
    ]),
  );

  const geo = latestRun ? toGeoScoreComponent(latestRun) : null;

  const seo = aggregateSeoComponent({
    technicalScores: technicalRows.map((r) => r.score),
    contentScore: contentRow ? contentRow.score : null,
    measuredAtCandidates: [...technicalRows.map((r) => r.analyzed_at), ...(contentRow ? [contentRow.analyzed_at] : [])],
    pagesAnalyzed: technicalRows.length,
  });

  return { geo, seo, capturedAt: new Date().toISOString() };
}
