/**
 * Epic 9 (Opportunity Engine) — brand-scoped routes
 * (`docs/epics/09-opportunity-engine.md`'s "API surface"):
 *
 *   POST /brands/me/opportunities/recompute — runs the SEO+GEO merge.
 *   GET  /brands/me/opportunities           — list, sortable/filterable.
 *
 * The id-addressed `GET /opportunities/:id` and `PATCH /opportunities/:id`
 * live in `routes/opportunity-details.ts`, same split Epic 7 uses
 * (`routes/ai-runs.ts` vs. `routes/ai-run-details.ts`).
 *
 * ── The merge, end to end ────────────────────────────────────────────────
 * 1. `loadCompetitiveDataset` (Epic 8's own data-loading function — not
 *    re-implemented) resolves the brand's ACTIVE query set (Epic 5's
 *    "Query Universe") plus the brand's and every competitor's most recent
 *    COMPLETED run on it. `dataset.queries` IS the intent universe this
 *    epic's spec says to iterate.
 * 2. Epic 4's `seo_keywords` (via their owning `keyword_groups.brand_id`)
 *    are matched against each query's `text`, case-insensitively and
 *    trimmed (documented v1 limitation — no fuzzy matching — in
 *    `@bebest/database` DECISIONS.md's Epic 9 section: the two tables have
 *    no shared key). The matched keyword's most recent `seo_opportunities`
 *    row (if `POST /keyword-groups/generate` already produced one) is
 *    preferred over recomputing from scratch.
 * 3. Epic 8's `classifyIntentGaps` (not re-implemented) runs once over
 *    every query in the set, keyed by `queries.id` directly — no matching
 *    needed on this side.
 * 4. `buildMergeResult` (`lib/opportunities/merge-scoring.ts`) turns
 *    whichever signal(s) are present into one `unified_opportunities` row
 *    plus its evidence, or `null` when neither is present (skipped).
 * 5. Idempotent upsert keyed on `(organization_id, brand_id, query_id)` —
 *    see the handler below for the exact dismissed-row / material-change
 *    handling this epic's DoD calls out by name.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { loadCompetitiveDataset } from '../lib/ai-visibility/competitive-dataset.js';
import { classifyIntentGaps, computeQueryStats, type IntentGapFinding, type QueryComparisonInput, type QueryStats } from '../lib/ai-visibility/competitive.js';
import type { ScoredObservation } from '../lib/ai-visibility/scoring.js';
import { buildMergeResult, buildQueryComparisonSentence, isMaterialChange, type MergeResult } from '../lib/opportunities/merge-scoring.js';
import { serializeOpportunity } from '../lib/opportunities/serialize.js';
import type { AppEnv } from '../types/context.js';
import type { brand_observations, seo_keywords, unified_opportunity_type } from '@bebest/database';

const opportunitiesRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const MUTATE = 'create_brand_profile' as const;

const NO_ACTIVE_QUERY_SET_ERROR = {
  error: 'no_active_query_set',
  message: 'This brand has no active query set. Generate and activate one first via /api/brands/me/query-sets.',
} as const;

// ── SEO-side matching (Epic 4) ───────────────────────────────────────────

/** Trimmed, case-insensitive, whitespace-collapsed — the documented v1
 * matching rule (`seo_keywords` has no FK to `queries`; see
 * `@bebest/database` DECISIONS.md's Epic 9 section). */
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
    if (!keywordByText.has(key)) keywordByText.set(key, row); // first match wins — documented above
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
    if (row.keyword_id && !opportunityByKeywordId.has(row.keyword_id)) opportunityByKeywordId.set(row.keyword_id, row); // most recent wins (desc order)
  }

  return { keywordByText, opportunityByKeywordId };
}

// ── GEO-side matching (Epic 8) ───────────────────────────────────────────

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

/** Builds the per-query brand/competitor mention-rate stats this route
 * needs for BOTH `classifyIntentGaps` (Epic 8, reused as-is) and the
 * evidence sentence (`buildQueryComparisonSentence`, also Epic 8's own) —
 * computed once, not once for classification and again for evidence. */
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
      // citedDomains is irrelevant to classifyIntentGaps (it only reads
      // mentionRatePct off `.stats`) — left empty rather than fetched, see
      // this file's header comment #3.
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

// ── POST /recompute ───────────────────────────────────────────────────────

opportunitiesRoute.post('/recompute', requireAuth, requireOrgFromToken('viewer'), requirePermission(MUTATE), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const dataset = await loadCompetitiveDataset(org.organizationId, brand.id);
  if ('error' in dataset) return c.json(NO_ACTIVE_QUERY_SET_ERROR, 404);

  const { keywordByText, opportunityByKeywordId } = await loadSeoSignalIndex(org.organizationId, brand.id);
  const { comparisonRows, perQuery } = buildGeoStats(dataset);

  const intentGapFindings: IntentGapFinding[] = comparisonRows.length ? classifyIntentGaps(comparisonRows) : [];
  const findingByQueryId = new Map(intentGapFindings.map((f) => [f.queryId, f]));

  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let skippedDismissed = 0;
  let skippedNoSignal = 0;
  const touchedIds: string[] = [];

  await withOrgContext(org.organizationId, async (tx) => {
    // Sequential, not Promise.all — same shared-`tx` constraint every other
    // multi-write route in this codebase documents (Prisma's
    // TransactionClient does not support concurrent queries on one
    // transaction).
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
        where: { organization_id: org.organizationId, brand_id: brand.id, query_id: query.id },
      });

      if (!existing) {
        const createdRow = await tx.unified_opportunities.create({
          data: {
            organization_id: org.organizationId,
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
            organization_id: org.organizationId,
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
          // Explicitly documented behavior (this epic's end-to-end flow
          // step 5): a dismissed opportunity does NOT reappear just
          // because `recompute` ran again — only a materially changed
          // underlying signal revives it.
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
          // Reviving a dismissed row is a SYSTEM action (the signal
          // changed, no human acted) — status resets to 'new' and
          // `updated_by`/`dismissal_reason` are cleared rather than
          // attributing the change to whichever human dismissed it
          // originally.
          ...(existing.status === 'dismissed' ? { status: 'new' as const, dismissal_reason: null, updated_by: null } : {}),
          updated_at: new Date(),
        },
      });
      await tx.opportunity_evidence.deleteMany({ where: { opportunity_id: existing.id } });
      await tx.opportunity_evidence.createMany({
        data: mergeResult.evidence.map((e) => ({
          organization_id: org.organizationId,
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
    ? await withOrgContext(org.organizationId, (tx) =>
        tx.unified_opportunities.findMany({
          where: { id: { in: touchedIds } },
          orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        }),
      )
    : [];

  await writeManualAuditEvent(c, { action: 'opportunity.recomputed', entityType: 'brand', entityId: brand.id });

  return c.json({
    querySetId: dataset.querySet.id,
    summary: {
      intentsConsidered: dataset.queries.length,
      created,
      updated,
      reactivated,
      skippedDismissed,
      skippedNoSignal,
    },
    opportunities: touchedRows.map(serializeOpportunity),
  });
});

// ── GET / — list, sortable by opportunity_score, filterable by
// type/status/priority ────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'dismissed']).optional(),
  type: z.enum(['seo', 'geo', 'unified', 'content', 'technical']).optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

opportunitiesRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  const { status, type, priority, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    ...(status ? { status } : {}),
    ...(type ? { type: type as unified_opportunity_type } : {}),
    ...(priority ? { priority } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.unified_opportunities.count({ where }),
      tx.unified_opportunities.findMany({
        where,
        orderBy: [{ opportunity_score: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]),
  );

  return c.json({
    opportunities: rows.map(serializeOpportunity),
    pagination: { total, limit, offset },
  });
});

export default opportunitiesRoute;
