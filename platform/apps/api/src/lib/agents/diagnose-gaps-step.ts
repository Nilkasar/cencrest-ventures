/**
 * Shared step used by the GEO and Growth agents: "diagnose gaps" per
 * `docs/epics/12-agents.md`'s GEO Agent flow. Loads Epic 8's own dataset
 * (`loadCompetitiveDataset`) and runs Epic 8's own classification functions
 * (`classifyIntentGaps` et al.) DIRECTLY — no gap-finding logic is
 * reimplemented here, only the same kind of Prisma-row-to-function-input
 * mapping every other consumer of these pure functions already writes for
 * itself (`routes/competitive-intelligence.ts` and
 * `lib/opportunities/recompute.ts` each have their own version of this
 * exact glue, because the classification functions are pure and
 * intentionally know nothing about Prisma shapes).
 *
 * Returns at most `limit` findings, highest-severity first — an agent event
 * log surfaces the handful that matter, not a full data dump; the complete
 * set remains available via `GET /brands/me/competitive-gaps` for anyone
 * who wants it.
 */
import { loadCompetitiveDataset } from '../ai-visibility/competitive-dataset.js';
import { classifyIntentGaps, computeQueryStats, type IntentGapFinding, type QueryComparisonInput } from '../ai-visibility/competitive.js';
import type { ScoredObservation } from '../ai-visibility/scoring.js';
import type { brand_observations } from '@bebest/database';

function toScoredObservations(observations: readonly brand_observations[]): ScoredObservation[] {
  return observations.map((o) => ({
    queryId: o.query_id,
    brandMentioned: o.brand_mentioned,
    brandRecommended: o.brand_recommended,
    brandFirstPosition: o.brand_first_position === null ? null : Number(o.brand_first_position),
  }));
}

export type DiagnoseGapsResult =
  | { error: 'no_active_query_set' }
  | { error: 'no_brand_run' }
  | { findings: IntentGapFinding[] };

const SEVERITY_RANK: Record<IntentGapFinding['severity'], number> = { high: 3, medium: 2, low: 1 };

export async function diagnoseGapsStep(organizationId: string, brandId: string, limit = 3): Promise<DiagnoseGapsResult> {
  const dataset = await loadCompetitiveDataset(organizationId, brandId);
  if ('error' in dataset) return { error: 'no_active_query_set' };
  if (!dataset.brand) return { error: 'no_brand_run' };

  const brandEntry = dataset.brand;
  const brandObservations = toScoredObservations(brandEntry.observations);
  const brandTotalProviders = brandEntry.run.providers.length;

  const competitorSummaries = dataset.competitors
    .filter((c) => c.entry !== null)
    .map((c) => ({
      id: c.competitor.id,
      name: c.competitor.name,
      observations: toScoredObservations(c.entry!.observations),
      totalProviders: c.entry!.run.providers.length,
    }));

  const comparisonRows: QueryComparisonInput[] = dataset.queries.map((query) => ({
    queryId: query.id,
    queryText: query.text,
    category: query.category,
    yourStats: computeQueryStats(brandObservations.filter((o) => o.queryId === query.id), brandTotalProviders),
    yourCitedDomains: [],
    competitors: competitorSummaries.map((c) => ({
      competitorId: c.id,
      competitorName: c.name,
      stats: computeQueryStats(c.observations.filter((o) => o.queryId === query.id), c.totalProviders),
      citedDomains: [],
    })),
  }));

  const findings = classifyIntentGaps(comparisonRows)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, limit);

  return { findings };
}
