/**
 * Epic 15 (Reporting & Notifications) — the baseline-comparison report's
 * "before" side: the brand's EARLIEST completed score, mirroring Epic 14's
 * `current-score-snapshot.ts` exactly but ordered ascending instead of
 * descending. Reuses that file's own exported shaping functions
 * (`toGeoScoreComponent`/`aggregateSeoComponent`) rather than
 * reimplementing the GEO/SEO -> `ScoreSnapshot` conversion — this epic's
 * own non-negotiable is "pull from already-computed data via real
 * functions/queries, no reimplemented scoring logic," and those two
 * functions ARE Epic 14's real, already-tested shaping logic.
 *
 * There is no explicit "baseline" flag anywhere in the schema (grepped —
 * none exists), so "the customer's original baseline" (this epic's spec,
 * verbatim) is defined here as the brand's first-ever completed GEO run
 * plus its earliest-analyzed SEO pages — the honest, literal reading of
 * "since the original baseline" when no dedicated baseline record exists.
 */
import { withOrgContext } from '@bebest/database';
import { toGeoScoreComponent, aggregateSeoComponent } from '../measurement/current-score-snapshot.js';
import type { ScoreSnapshot } from '../measurement/scoring.js';

export async function getBaselineScoreSnapshot(organizationId: string, brandId: string): Promise<ScoreSnapshot> {
  const [earliestRun, technicalRows, contentRow] = await withOrgContext(organizationId, (tx) =>
    Promise.all([
      tx.ai_runs.findFirst({
        where: { organization_id: organizationId, brand_id: brandId, competitor_id: null, status: 'completed' },
        orderBy: { completed_at: 'asc' },
      }),
      // Earliest row PER PAGE (distinct + ascending order — the mirror
      // image of `current-score-snapshot.ts`'s "latest row per page").
      tx.seo_analyses.findMany({
        where: { organization_id: organizationId, brand_id: brandId, analysis_type: 'technical' },
        orderBy: { analyzed_at: 'asc' },
        distinct: ['page_id'],
      }),
      tx.seo_analyses.findFirst({
        where: { organization_id: organizationId, brand_id: brandId, analysis_type: 'content' },
        orderBy: { analyzed_at: 'asc' },
      }),
    ]),
  );

  const geo = earliestRun ? toGeoScoreComponent(earliestRun) : null;

  const seo = aggregateSeoComponent({
    technicalScores: technicalRows.map((r) => r.score),
    contentScore: contentRow ? contentRow.score : null,
    measuredAtCandidates: [...technicalRows.map((r) => r.analyzed_at), ...(contentRow ? [contentRow.analyzed_at] : [])],
    pagesAnalyzed: technicalRows.length,
  });

  // `capturedAt` for a baseline snapshot is when the data itself was first
  // captured (the earliest run's completion), not "now" — unlike
  // `getCurrentScoreSnapshot`, which always means "as of this read."
  const capturedAt = earliestRun?.completed_at ?? earliestRun?.created_at ?? new Date();

  return { geo, seo, capturedAt: capturedAt.toISOString() };
}
