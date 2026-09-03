/**
 * Epic 9 (Opportunity Engine) — the `POST /recompute` merge logic, extracted
 * out of `routes/opportunities.ts` into one reusable function (behavior
 * UNCHANGED — a pure code move, not a rewrite) so Epic 12's GEO/SEO/Growth
 * agents can call the exact same, already-tested idempotent-upsert engine
 * logic instead of re-implementing any part of it — this epic's own "thin
 * orchestrator... do not reimplement any of their logic" requirement.
 * `routes/opportunities.ts` now calls this same function; nothing about its
 * HTTP contract (status codes, response shape, audit event) changed.
 *
 * See that route file's own header comment for the merge algorithm itself
 * (`loadCompetitiveDataset` -> SEO keyword matching -> `classifyIntentGaps`
 * -> `buildMergeResult` -> idempotent upsert) — unchanged here, just moved.
 */
import { withOrgContext, type Prisma, type brand_observations, type seo_keywords, type unified_opportunities } from '@bebest/database';
import { getBrandForOrg } from '../brand-context.js';
import { loadCompetitiveDataset } from '../ai-visibility/competitive-dataset.js';
import { classifyIntentGaps, computeQueryStats, type IntentGapFinding, type QueryComparisonInput, type QueryStats } from '../ai-visibility/competitive.js';
import type { ScoredObservation } from '../ai-visibility/scoring.js';
import { buildMergeResult, buildQueryComparisonSentence, isMaterialChange, type MergeResult } from './merge-scoring.js';

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function loadSeoSignalIndex(organizationId: string, brandId: string) {
  const keywordRows = await withOrgContext(organizationId, (tx) =>
    tx.seo_keywords.findMany({
      where: { organization_id: organizationId, deleted_at: null, keyword_groups: { brand_id: brandId, deleted_at: null } },
    }),
  );

  const keywordByText = new Map<string, seo_keywords>();
  for (const row of keywordRows) {
    const key = normalizeText(row.text);
    if (!keywordByText.has(key)) keywordByText.set(key, row);
  }

  const keywordIds = keywordRows.map((k) => k.id);
  const opportunityRows = keywordIds.length
    ? await withOrgContext(organizationId, (tx) =>
        tx.seo_opportunities.findMany({
          where: { organization_id: organizationId, brand_id: brandId, keyword_id: { in: keywordIds } },
          orderBy: { created_at: 'desc' },
        }),
      )
    : [];

  const opportunityByKeywordId = new Map<string, (typeof opportunityRows)[number]>();
  for (const row of opportunityRows) {
    if (row.keyword_id && !opportunityByKeywordId.has(row.keyword_id)) opportunityByKeywordId.set(row.keyword_id, row);
  }

  return { keywordByText, opportunityByKeywordId };
}

function toScoredObservations(observations: readonly brand_observations[]): ScoredObservation[] {
  return observations.map((o) => ({
    queryId: o.query_id,
    brandMentioned: o.brand_mentioned,
    brandRecommended: o.brand_recommended,
    brandFirstPosition: o.brand_first_position === null ? null : Number(o.brand_first_position),
  }));
}

interface PerQueryGeoStats {
  yourStats: QueryStats;
  competitorStats: Map<string, { name: string; runId: string; stats: QueryStats }>;
}

function buildGeoStats(dataset: Awaited<ReturnType<typeof loadCompetitiveDataset>>): { comparisonRows: QueryComparisonInput[]; perQuery: Map<string, PerQueryGeoStats> } {
  const comparisonRows: QueryComparisonInput[] = [];
  const perQuery = new Map<string, PerQueryGeoStats>();
  if ('error' in dataset || !dataset.brand) return { comparisonRows, perQuery };

  const brandEntry = dataset.brand;
  const brandObservations = toScoredObservations(brandEntry.observations);
  const brandTotalProviders = brandEntry.run.providers.length;

  const competitorSummaries = dataset.competitors
    .filter((c) => c.entry !== null)
    .map((c) => ({
      id: c.competitor.id,
      name: c.competitor.name,
      runId: c.entry!.run.id,
      observations: toScoredObservations(c.entry!.observations),
      totalProviders: c.entry!.run.providers.length,
    }));

  for (const query of dataset.queries) {
    const yourStats = computeQueryStats(
      brandObservations.filter((o) => o.queryId === query.id),
      brandTotalProviders,
    );

    const competitorStats = new Map<string, { name: string; runId: string; stats: QueryStats }>();
    const competitorsForRow: QueryComparisonInput['competitors'] = [];
    for (const c of competitorSummaries) {
      const stats = computeQueryStats(
        c.observations.filter((o) => o.queryId === query.id),
        c.totalProviders,
      );
      competitorStats.set(c.id, { name: c.name, runId: c.runId, stats });
      competitorsForRow.push({ competitorId: c.id, competitorName: c.name, stats, citedDomains: [] });
    }

    comparisonRows.push({
      queryId: query.id,
      queryText: query.text,
      category: query.category,
      yourStats,
      yourCitedDomains: [],
      competitors: competitorsForRow,
    });
    perQuery.set(query.id, { yourStats, competitorStats });
  }

  return { comparisonRows, perQuery };
}

export interface RecomputeSummary {
  intentsConsidered: number;
  created: number;
  updated: number;
  reactivated: number;
  skippedDismissed: number;
  skippedNoSignal: number;
}

export type RecomputeOpportunitiesResult =
  | { error: 'no_brand' }
  | { error: 'no_active_query_set' }
  | { querySetId: string; summary: RecomputeSummary; opportunities: unified_opportunities[] };

export async function recomputeOpportunitiesForBrand(organizationId: string): Promise<RecomputeOpportunitiesResult> {
  const brand = await getBrandForOrg(organizationId);
  if (!brand) return { error: 'no_brand' };

  const dataset = await loadCompetitiveDataset(organizationId, brand.id);
  if ('error' in dataset) return { error: 'no_active_query_set' };

  const { keywordByText, opportunityByKeywordId } = await loadSeoSignalIndex(organizationId, brand.id);
  const { comparisonRows, perQuery } = buildGeoStats(dataset);

  const intentGapFindings: IntentGapFinding[] = comparisonRows.length ? classifyIntentGaps(comparisonRows) : [];
  const findingByQueryId = new Map(intentGapFindings.map((f) => [f.queryId, f]));

  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let skippedDismissed = 0;
  let skippedNoSignal = 0;
  const touchedIds: string[] = [];

  await withOrgContext(organizationId, async (tx) => {
    for (const query of dataset.queries) {
      const matchedKeyword = keywordByText.get(normalizeText(query.text)) ?? null;
      const matchedOpportunity = matchedKeyword ? (opportunityByKeywordId.get(matchedKeyword.id) ?? null) : null;
      const finding = findingByQueryId.get(query.id) ?? null;

      const perQ = perQuery.get(query.id);
      const mergeResult: MergeResult | null = buildMergeResult({
        queryId: query.id,
        queryText: query.text,
        seo: matchedKeyword
          ? {
              keywordId: matchedKeyword.id,
              keywordText: matchedKeyword.text,
              monthlyVolume: matchedKeyword.monthly_volume,
              difficulty: matchedKeyword.difficulty,
              intent: matchedKeyword.intent,
              matchedOpportunityId: matchedOpportunity?.id ?? null,
              matchedOpportunityValueScore: matchedOpportunity ? Number(matchedOpportunity.value_score) : null,
            }
          : null,
        geo:
          finding && perQ
            ? {
                finding,
                competitorEvidence: finding.competitors.map((fc) => {
                  const compStat = perQ.competitorStats.get(fc.competitorId)!;
                  return {
                    competitorId: fc.competitorId,
                    competitorName: fc.competitorName,
                    competitorRunId: compStat.runId,
                    mentionRatePct: fc.mentionRatePct,
                    sentence: buildQueryComparisonSentence({
                      queryText: query.text,
                      competitorName: fc.competitorName,
                      competitorStats: compStat.stats,
                      yourStats: perQ.yourStats,
                    }),
                  };
                }),
              }
            : null,
      });

      if (!mergeResult) {
        skippedNoSignal += 1;
        continue;
      }

      const existing = await tx.unified_opportunities.findFirst({
        where: { organization_id: organizationId, brand_id: brand.id, query_id: query.id },
      });

      if (!existing) {
        const createdRow = await tx.unified_opportunities.create({
          data: {
            organization_id: organizationId,
            brand_id: brand.id,
            query_id: query.id,
            intent_text: query.text,
            type: mergeResult.type,
            seo_demand_score: mergeResult.seoDemandScore,
            geo_gap_score: mergeResult.geoGapScore,
            effort_score: mergeResult.effortScore,
            impact_score: mergeResult.impactScore,
            opportunity_score: mergeResult.opportunityScore,
            scoring_formula_version: mergeResult.formulaVersion,
            status: 'new',
            priority: mergeResult.priority,
            title: mergeResult.title,
          },
        });
        await tx.opportunity_evidence.createMany({
          data: mergeResult.evidence.map((e) => ({
            organization_id: organizationId,
            opportunity_id: createdRow.id,
            source_table: e.sourceTable,
            source_id: e.sourceId,
            summary: e.summary,
            raw_data: e.rawData as unknown as Prisma.InputJsonValue,
          })),
        });
        created += 1;
        touchedIds.push(createdRow.id);
        continue;
      }

      if (existing.status === 'dismissed') {
        const material = isMaterialChange(
          { type: existing.type, opportunityScore: Number(existing.opportunity_score) },
          { type: mergeResult.type, opportunityScore: mergeResult.opportunityScore },
        );
        if (!material) {
          skippedDismissed += 1;
          continue;
        }
        reactivated += 1;
      } else {
        updated += 1;
      }

      await tx.unified_opportunities.update({
        where: { id: existing.id },
        data: {
          type: mergeResult.type,
          seo_demand_score: mergeResult.seoDemandScore,
          geo_gap_score: mergeResult.geoGapScore,
          effort_score: mergeResult.effortScore,
          impact_score: mergeResult.impactScore,
          opportunity_score: mergeResult.opportunityScore,
          scoring_formula_version: mergeResult.formulaVersion,
          priority: mergeResult.priority,
          title: mergeResult.title,
          intent_text: query.text,
          ...(existing.status === 'dismissed' ? { status: 'new' as const, dismissal_reason: null, updated_by: null } : {}),
          updated_at: new Date(),
        },
      });
      await tx.opportunity_evidence.deleteMany({ where: { opportunity_id: existing.id } });
      await tx.opportunity_evidence.createMany({
        data: mergeResult.evidence.map((e) => ({
          organization_id: organizationId,
          opportunity_id: existing.id,
          source_table: e.sourceTable,
          source_id: e.sourceId,
          summary: e.summary,
          raw_data: e.rawData as unknown as Prisma.InputJsonValue,
        })),
      });
      touchedIds.push(existing.id);
    }
  });

  const touchedRows = touchedIds.length
    ? await withOrgContext(organizationId, (tx) =>
        tx.unified_opportunities.findMany({
          where: { id: { in: touchedIds } },
          orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        }),
      )
    : [];

  return {
    querySetId: dataset.querySet.id,
    summary: { intentsConsidered: dataset.queries.length, created, updated, reactivated, skippedDismissed, skippedNoSignal },
    opportunities: touchedRows,
  };
}
