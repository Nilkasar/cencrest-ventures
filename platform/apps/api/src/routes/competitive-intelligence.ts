/**
 * Epic 8 (Competitive Intelligence) — the two read-only comparison
 * endpoints (`docs/epics/08-competitive-intelligence.md`'s "API surface"):
 *
 *   GET /brands/me/competitive-gaps  — Competitive Gap (aggregate + per
 *     intent_type), the per-query breakdown sentences, and the four
 *     classified gap-type findings.
 *   GET /brands/me/share-of-voice    — Share of AI Voice across the brand
 *     and every tracked competitor.
 *
 * Both read `lib/ai-visibility/competitive-dataset.ts` (the brand's active
 * query set + the most recent COMPLETED run each entity has on it) and run
 * every number through `lib/ai-visibility/competitive.ts`'s pure functions
 * — no formula lives in this file.
 *
 * Neither endpoint fails hard when a competitor (or even the brand itself)
 * hasn't completed a run yet on the current query set: `computed: false`
 * plus empty arrays is a normal, 200 response — the same "poll this like
 * run status, never guess whether the shape means 'error' or 'not ready
 * yet'" convention `GET /ai-runs/:id/score` established in Epic 7.
 */
import { Hono } from 'hono';
import { withOrgContext, type brand_observations } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { loadCompetitiveDataset, type EntityRun } from '../lib/ai-visibility/competitive-dataset.js';
import {
  buildQueryComparisonSentence,
  classifyContentGaps,
  classifyEntityGaps,
  classifyIntentGaps,
  classifySourceGaps,
  computeCompetitiveGap,
  computeCompetitorMovement,
  computeQueryStats,
  computePerIntentTypeGaps,
  computeShareOfAiVoice,
  type DomainCitationInput,
  type GapFinding,
  type QueryComparisonInput,
  type QueryStats,
} from '../lib/ai-visibility/competitive.js';
import type { ScoredObservation } from '../lib/ai-visibility/scoring.js';
import type { AppEnv } from '../types/context.js';

const competitiveIntelligenceRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;

const NO_ACTIVE_QUERY_SET_ERROR = {
  error: 'no_active_query_set',
  message: 'This brand has no active query set. Generate and activate one first via /api/brands/me/query-sets.',
} as const;

function toNumberOrNull(value: { toString(): string } | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toScoredObservations(observations: readonly brand_observations[]): ScoredObservation[] {
  return observations.map((o) => ({
    queryId: o.query_id,
    brandMentioned: o.brand_mentioned,
    brandRecommended: o.brand_recommended,
    brandFirstPosition: o.brand_first_position === null ? null : Number(o.brand_first_position),
  }));
}

function citedDomainsFor(observations: readonly brand_observations[], queryId: string): string[] {
  const domains = new Set<string>();
  for (const o of observations) {
    if (o.query_id !== queryId) continue;
    for (const d of o.cited_domains) domains.add(d);
  }
  return [...domains];
}

function allCitedDomains(observations: readonly brand_observations[]): string[] {
  const domains: string[] = [];
  for (const o of observations) domains.push(...o.cited_domains);
  return domains;
}

function serializeEntityRun(entry: EntityRun | null) {
  if (!entry) return null;
  return {
    id: entry.run.id,
    aiVisibilityScore: toNumberOrNull(entry.run.ai_visibility_score),
    completedAt: entry.run.completed_at,
  };
}

/** Finds the completed run immediately BEFORE `beforeCreatedAt` for this
 * entity — deliberately not scoped to the current active query_set (see
 * `computeCompetitorMovement`'s doc comment: a trend line legitimately
 * spans query-set versions; only the point-in-time comparisons in
 * `competitive-gaps` require an exact query_set match). */
async function findPreviousCompletedRun(organizationId: string, brandId: string, competitorId: string | null, beforeCreatedAt: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.ai_runs.findFirst({
      where: {
        organization_id: organizationId,
        brand_id: brandId,
        competitor_id: competitorId,
        status: 'completed',
        created_at: { lt: beforeCreatedAt },
      },
      orderBy: { created_at: 'desc' },
    }),
  );
}

// ── GET /competitive-gaps ─────────────────────────────────────────────────
competitiveIntelligenceRoute.get('/competitive-gaps', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const dataset = await loadCompetitiveDataset(org.organizationId, brand.id);
  if ('error' in dataset) return c.json(NO_ACTIVE_QUERY_SET_ERROR, 404);

  const brandEntry = dataset.brand;
  const brandObservations = brandEntry ? toScoredObservations(brandEntry.observations) : [];
  const brandTotalProviders = brandEntry?.run.providers.length ?? 0;
  const brandAvs = brandEntry ? toNumberOrNull(brandEntry.run.ai_visibility_score) : null;

  const intentTypeQueries = dataset.queries.map((q) => ({ id: q.id, intentType: q.intent_type }));

  const competitorSummaries = dataset.competitors.map((c) => {
    const entry = c.entry;
    const competitorAvs = entry ? toNumberOrNull(entry.run.ai_visibility_score) : null;
    const competitorObservations = entry ? toScoredObservations(entry.observations) : [];
    const competitorTotalProviders = entry?.run.providers.length ?? 0;

    return {
      competitorId: c.competitor.id,
      competitorName: c.competitor.name,
      run: serializeEntityRun(entry),
      competitiveGap: computeCompetitiveGap(competitorAvs, brandAvs),
      perIntentTypeGap:
        brandEntry && entry
          ? computePerIntentTypeGaps(intentTypeQueries, brandObservations, brandTotalProviders, competitorObservations, competitorTotalProviders)
          : [],
      _entry: entry,
      _competitorObservations: competitorObservations,
      _competitorTotalProviders: competitorTotalProviders,
    };
  });

  // Per-query breakdown + the four gap types — only meaningful once the
  // brand itself has a completed run to compare against.
  const comparisonRows: QueryComparisonInput[] = [];
  const perQueryBreakdown: Array<{
    queryId: string;
    queryText: string;
    intentType: string | null;
    category: string | null;
    yourStats: QueryStats;
    competitors: Array<{ competitorId: string; competitorName: string; stats: QueryStats; sentence: string }>;
  }> = [];

  if (brandEntry) {
    for (const query of dataset.queries) {
      const yourObsForQuery = brandObservations.filter((o) => o.queryId === query.id);
      const yourStats = computeQueryStats(yourObsForQuery, brandTotalProviders);
      const yourCitedDomains = citedDomainsFor(brandEntry.observations, query.id);

      const competitorsForRow: QueryComparisonInput['competitors'] = [];
      const competitorsForBreakdown: (typeof perQueryBreakdown)[number]['competitors'] = [];

      for (const summary of competitorSummaries) {
        if (!summary._entry) continue;
        const obsForQuery = summary._competitorObservations.filter((o) => o.queryId === query.id);
        const stats = computeQueryStats(obsForQuery, summary._competitorTotalProviders);
        const citedDomains = citedDomainsFor(summary._entry.observations, query.id);

        competitorsForRow.push({ competitorId: summary.competitorId, competitorName: summary.competitorName, stats, citedDomains });
        competitorsForBreakdown.push({
          competitorId: summary.competitorId,
          competitorName: summary.competitorName,
          stats,
          sentence: buildQueryComparisonSentence({ queryText: query.text, competitorName: summary.competitorName, competitorStats: stats, yourStats }),
        });
      }

      comparisonRows.push({
        queryId: query.id,
        queryText: query.text,
        category: query.category,
        yourStats,
        yourCitedDomains,
        competitors: competitorsForRow,
      });

      perQueryBreakdown.push({
        queryId: query.id,
        queryText: query.text,
        intentType: query.intent_type,
        category: query.category,
        yourStats,
        competitors: competitorsForBreakdown,
      });
    }
  }

  const domainCitationInputs: DomainCitationInput[] = competitorSummaries
    .filter((s) => s._entry)
    .map((s) => ({
      competitorId: s.competitorId,
      competitorName: s.competitorName,
      citedDomains: allCitedDomains(s._entry!.observations),
      totalJobs: s._entry!.run.total_jobs,
    }));

  const gaps: GapFinding[] = brandEntry
    ? [
        ...classifyIntentGaps(comparisonRows),
        ...classifyContentGaps(comparisonRows),
        ...classifyEntityGaps(comparisonRows),
        ...classifySourceGaps(allCitedDomains(brandEntry.observations), domainCitationInputs),
      ]
    : [];

  return c.json({
    querySetId: dataset.querySet.id,
    computed: brandEntry !== null,
    brandRun: serializeEntityRun(brandEntry),
    competitors: competitorSummaries.map(({ _entry, _competitorObservations, _competitorTotalProviders, ...rest }) => rest),
    perQueryBreakdown,
    gaps,
  });
});

// ── GET /share-of-voice ────────────────────────────────────────────────────
competitiveIntelligenceRoute.get('/share-of-voice', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const dataset = await loadCompetitiveDataset(org.organizationId, brand.id);
  if ('error' in dataset) return c.json(NO_ACTIVE_QUERY_SET_ERROR, 404);

  // "Mentions" = count of (query x provider) observations where
  // brand_mentioned is true, for whichever run is each entity's most
  // recent completed run on the CURRENT active query set. A competitor (or
  // even the brand) with no completed run yet contributes 0 mentions —
  // literally true (no evidence exists yet), not a distinct "unknown"
  // state — which is exactly what makes the zero-mention boundary case
  // fall out of the same code path as everything else, no special-casing
  // required. See lib/ai-visibility/competitive.ts's `computeShareOfAiVoice`
  // doc comment for the full boundary-behavior contract.
  const yourMentions = dataset.brand ? dataset.brand.observations.filter((o) => o.brand_mentioned).length : 0;

  const competitorMentions: Record<string, number> = {};
  const namesById: Record<string, string> = {};
  for (const c2 of dataset.competitors) {
    namesById[c2.competitor.id] = c2.competitor.name;
    competitorMentions[c2.competitor.id] = c2.entry ? c2.entry.observations.filter((o) => o.brand_mentioned).length : 0;
  }

  const result = computeShareOfAiVoice(yourMentions, competitorMentions);

  return c.json({
    querySetId: dataset.querySet.id,
    yourMentions: result.yourMentions,
    yourSharePct: result.yourSharePct,
    totalMentions: result.totalMentions,
    competitors: dataset.competitors.map((c2) => ({
      competitorId: c2.competitor.id,
      competitorName: namesById[c2.competitor.id],
      mentions: competitorMentions[c2.competitor.id],
      sharePct: result.competitorShares[c2.competitor.id] ?? 0,
      tracked: c2.entry !== null,
    })),
  });
});

// ── GET /competitors/:competitorId/movement — the pure comparison logic
// this epic's spec asks to "build now," exposed on demand rather than via
// a schedule (Epic 12's Competitor Agent owns the actual trigger). ───────
competitiveIntelligenceRoute.get(
  '/competitors/:competitorId/movement',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(VIEW),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const competitor = await withOrgContext(org.organizationId, (tx) =>
      tx.competitors.findFirst({ where: { id: c.req.param('competitorId'), organization_id: org.organizationId, brand_id: brand.id, deleted_at: null } }),
    );
    if (!competitor) return c.json({ error: 'Competitor not found' }, 404);

    const latestRun = await withOrgContext(org.organizationId, (tx) =>
      tx.ai_runs.findFirst({
        where: { organization_id: org.organizationId, brand_id: brand.id, competitor_id: competitor.id, status: 'completed' },
        orderBy: { created_at: 'desc' },
      }),
    );

    if (!latestRun) {
      return c.json(computeCompetitorMovement(competitor.name, null, null));
    }

    const previousRun = await findPreviousCompletedRun(org.organizationId, brand.id, competitor.id, latestRun.created_at);
    const latestScore = toNumberOrNull(latestRun.ai_visibility_score);
    const previousScore = toNumberOrNull(previousRun?.ai_visibility_score);

    return c.json(computeCompetitorMovement(competitor.name, previousScore, latestScore));
  },
);

export default competitiveIntelligenceRoute;
