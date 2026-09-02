/**
 * The shared read path for both Epic 8 endpoints
 * (`routes/competitive-intelligence.ts`'s `GET .../competitive-gaps` and
 * `GET .../share-of-voice`) — resolves the brand's active query set, its
 * most recent COMPLETED brand run on that exact query set, and every
 * tracked competitor's most recent COMPLETED run on that SAME query set,
 * plus every `brand_observations` row each of those runs produced.
 *
 * **Why "same query set" is a hard requirement, not just a preference.**
 * Every comparison this epic computes (Competitive Gap, Share of AI Voice,
 * the per-query breakdown sentences, all four gap types) is only meaningful
 * when the brand and its competitors were asked the IDENTICAL question set
 * — comparing a brand run against query_set v3 with a competitor run
 * against query_set v1 would silently compare answers to different
 * questions. A competitor with no completed run on the CURRENT active
 * query set is therefore treated as "not yet comparable" (`run: null`),
 * even if it has older completed runs on a since-superseded query set —
 * exactly analogous to how `query_sets.status` freezes a version (Epic 5)
 * so a later edit "must not silently mutate the same version other epics
 * may already be referencing."
 */
import { withOrgContext, type ai_runs, type brand_observations, type competitors, type queries, type query_sets } from '@bebest/database';

export interface EntityRun {
  run: ai_runs;
  observations: brand_observations[];
}

export interface CompetitorEntry {
  competitor: competitors;
  entry: EntityRun | null;
}

export interface CompetitiveDataset {
  querySet: query_sets;
  queries: queries[];
  brand: EntityRun | null;
  competitors: CompetitorEntry[];
}

export type CompetitiveDatasetError = { error: 'no_active_query_set' } | { error: 'no_brand' };

async function latestCompletedRun(
  organizationId: string,
  brandId: string,
  querySetId: string,
  competitorId: string | null,
): Promise<ai_runs | null> {
  return withOrgContext(organizationId, (tx) =>
    tx.ai_runs.findFirst({
      where: {
        organization_id: organizationId,
        brand_id: brandId,
        query_set_id: querySetId,
        competitor_id: competitorId,
        status: 'completed',
      },
      orderBy: { completed_at: 'desc' },
    }),
  );
}

async function observationsFor(organizationId: string, runId: string): Promise<brand_observations[]> {
  return withOrgContext(organizationId, (tx) => tx.brand_observations.findMany({ where: { ai_run_id: runId } }));
}

async function entityRunFor(
  organizationId: string,
  brandId: string,
  querySetId: string,
  competitorId: string | null,
): Promise<EntityRun | null> {
  const run = await latestCompletedRun(organizationId, brandId, querySetId, competitorId);
  if (!run) return null;
  const observations = await observationsFor(organizationId, run.id);
  return { run, observations };
}

export async function loadCompetitiveDataset(
  organizationId: string,
  brandId: string,
): Promise<CompetitiveDataset | CompetitiveDatasetError> {
  const querySet = await withOrgContext(organizationId, (tx) =>
    tx.query_sets.findFirst({
      where: { organization_id: organizationId, brand_id: brandId, status: 'active', deleted_at: null },
    }),
  );
  if (!querySet) return { error: 'no_active_query_set' };

  const [queryRows, competitorRows, brand] = await Promise.all([
    withOrgContext(organizationId, (tx) =>
      tx.queries.findMany({ where: { query_set_id: querySet.id, deleted_at: null }, orderBy: { created_at: 'asc' } }),
    ),
    withOrgContext(organizationId, (tx) =>
      tx.competitors.findMany({ where: { organization_id: organizationId, brand_id: brandId, deleted_at: null }, orderBy: { created_at: 'asc' } }),
    ),
    entityRunFor(organizationId, brandId, querySet.id, null),
  ]);

  const competitorEntries: CompetitorEntry[] = await Promise.all(
    competitorRows.map(async (competitor) => ({
      competitor,
      entry: await entityRunFor(organizationId, brandId, querySet.id, competitor.id),
    })),
  );

  return { querySet, queries: queryRows, brand, competitors: competitorEntries };
}
