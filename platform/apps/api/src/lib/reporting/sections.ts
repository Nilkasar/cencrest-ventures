/**
 * Epic 15 (Reporting & Notifications) — the three real-data sections every
 * non-baseline report type (weekly/monthly/custom) assembles, per the
 * spec's own domain model: "score deltas (Epic 14), new opportunities
 * (Epic 9), competitor movement (Epic 8)." Every query below reads an
 * already-computed table or calls an already-built pure function from the
 * epic that owns it — nothing here recomputes a score or a gap.
 */
import { withOrgContext, type measurements, type unified_opportunities } from '@bebest/database';
import { computeCompetitorMovement, type MovementResult } from '../ai-visibility/competitive.js';

/** Epic 14's real `measurements` rows (`score_delta`/`attribution_*`) —
 * the literal "score deltas" section. No recomputation: these rows were
 * already written by `lib/measurement/run-measurement.ts`. */
export async function getScoreDeltas(
  organizationId: string,
  brandId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<measurements[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.measurements.findMany({
      where: { organization_id: organizationId, brand_id: brandId, measured_at: { gte: periodStart, lte: periodEnd } },
      orderBy: { measured_at: 'desc' },
    }),
  );
}

/** Epic 9's real `unified_opportunities` rows discovered inside the
 * period — the literal "new opportunities" section. */
export async function getNewOpportunities(
  organizationId: string,
  brandId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<unified_opportunities[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.unified_opportunities.findMany({
      where: { organization_id: organizationId, brand_id: brandId, created_at: { gte: periodStart, lte: periodEnd } },
      orderBy: [{ opportunity_score: 'desc' }, { created_at: 'desc' }],
    }),
  );
}

export interface CompetitorMovementEntry extends MovementResult {
  competitorId: string;
  competitorName: string;
}

/** Epic 8's real `computeCompetitorMovement` (`lib/ai-visibility/
 * competitive.ts`) — the literal "competitor movement" section. For each
 * of the brand's (non-deleted) competitors, compares their latest
 * completed `ai_runs` score at-or-before `periodEnd` against their latest
 * completed score strictly before `periodStart` — the pure comparison
 * function itself is 100% reused, only the two scores fed into it are
 * queried here. */
export async function getCompetitorMovements(
  organizationId: string,
  brandId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<CompetitorMovementEntry[]> {
  const competitors = await withOrgContext(organizationId, (tx) =>
    tx.competitors.findMany({ where: { organization_id: organizationId, brand_id: brandId, deleted_at: null } }),
  );

  const movements: CompetitorMovementEntry[] = [];
  for (const competitor of competitors) {
    const [latestRun, previousRun] = await withOrgContext(organizationId, (tx) =>
      Promise.all([
        tx.ai_runs.findFirst({
          where: {
            organization_id: organizationId,
            brand_id: brandId,
            competitor_id: competitor.id,
            status: 'completed',
            completed_at: { lte: periodEnd },
          },
          orderBy: { completed_at: 'desc' },
        }),
        tx.ai_runs.findFirst({
          where: {
            organization_id: organizationId,
            brand_id: brandId,
            competitor_id: competitor.id,
            status: 'completed',
            completed_at: { lt: periodStart },
          },
          orderBy: { completed_at: 'desc' },
        }),
      ]),
    );

    const latestScore = latestRun?.ai_visibility_score === null || latestRun?.ai_visibility_score === undefined ? null : Number(latestRun.ai_visibility_score);
    const previousScore =
      previousRun?.ai_visibility_score === null || previousRun?.ai_visibility_score === undefined ? null : Number(previousRun.ai_visibility_score);

    movements.push({
      competitorId: competitor.id,
      competitorName: competitor.name,
      ...computeCompetitorMovement(competitor.name, previousScore, latestScore),
    });
  }

  return movements;
}
