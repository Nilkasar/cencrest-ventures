/**
 * Epic 8 (Competitive Intelligence) — `POST /brands/me/competitors/:competitorId/ai-runs`
 * runs the IDENTICAL Epic 7 pipeline (`lib/ai-visibility/pipeline.ts`,
 * completely unmodified in its EXECUTE/AGGREGATE logic — see that file's
 * top comment) against one competitor instead of the brand. This file
 * mirrors `routes/ai-runs.ts`'s PREPARE + QUEUE shape closely on purpose
 * (same entitlement-before-provider-call ordering, same 404/422/402 error
 * shapes) with exactly two differences: (1) it resolves + validates a
 * `competitorId` path param, and (2) it enforces a SECOND entitlement —
 * how many competitors may have ACTIVE AI-run tracking — on top of the
 * `ai_queries_per_month` check every run (brand or competitor) already goes
 * through.
 *
 * The spec's literal route shape (`docs/epics/08-competitive-intelligence.md`:
 * "POST /brands/:id/competitors/:competitorId/ai-runs") is adapted to
 * `/brands/me/competitors/:competitorId/ai-runs`, the same single-brand-
 * per-org convention every Epic 2+ route in this file uses.
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { checkUsageLimit, EntitlementLimitError } from '../lib/entitlements.js';
import { countAiQueriesThisMonth } from '../lib/ai-visibility/usage.js';
import { countTrackedCompetitors } from '../lib/ai-visibility/competitor-usage.js';
import { getDefaultAiProviderRegistry } from '../lib/ai-visibility/provider-registry.js';
import { scheduleAiVisibilityRun } from '../lib/ai-visibility/schedule-run.js';
import { serializeAiRun } from '../lib/ai-visibility/serialize.js';
import type { AppEnv } from '../types/context.js';

const competitorAiRunsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const RUN = 'run_ai_analysis' as const;

const NO_ACTIVE_QUERY_SET_ERROR = {
  error: 'no_active_query_set',
  message: 'This brand has no active query set. Generate and activate one first via /api/brands/me/query-sets.',
} as const;

const COMPETITOR_NOT_FOUND_ERROR = { error: 'Competitor not found' } as const;

/** Scoped by organization_id + brand_id + soft-delete — same
 * belt-and-suspenders tenant-isolation shape `routes/ai-run-details.ts`'s
 * `getAiRun` uses: a competitor from another org/brand 404s, never a 403
 * that would confirm the id exists. */
async function getCompetitorForBrand(organizationId: string, brandId: string, competitorId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.competitors.findFirst({ where: { id: competitorId, organization_id: organizationId, brand_id: brandId, deleted_at: null } }),
  );
}

// ── GET /:competitorId/ai-runs — this competitor's AI-run history, newest
// first. Never mixed with the brand's own runs or another competitor's —
// see routes/ai-runs.ts's GET / for the brand-only list. ────────────────
competitorAiRunsRoute.get(
  '/:competitorId/ai-runs',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(VIEW),
  async (c) => {
    const org = c.get('org');
    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const competitor = await getCompetitorForBrand(org.organizationId, brand.id, c.req.param('competitorId'));
    if (!competitor) return c.json(COMPETITOR_NOT_FOUND_ERROR, 404);

    const rows = await withOrgContext(org.organizationId, (tx) =>
      tx.ai_runs.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id, competitor_id: competitor.id },
        orderBy: { created_at: 'desc' },
      }),
    );

    return c.json(rows.map(serializeAiRun));
  },
);

// ── POST /:competitorId/ai-runs — PREPARE + QUEUE for a competitor run. ──
competitorAiRunsRoute.post(
  '/:competitorId/ai-runs',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(RUN),
  async (c) => {
    const org = c.get('org');
    const user = c.get('user');

    const brand = await getBrandForOrg(org.organizationId);
    if (!brand) return c.json(NO_BRAND_ERROR, 404);

    const competitor = await getCompetitorForBrand(org.organizationId, brand.id, c.req.param('competitorId'));
    if (!competitor) return c.json(COMPETITOR_NOT_FOUND_ERROR, 404);

    // Same active-query-set requirement as a brand run — the comparison
    // math (competitive-gaps, share-of-voice) depends on brand and
    // competitor runs sharing one query_set, so there is deliberately no
    // separate "competitor query set" concept.
    const querySet = await withOrgContext(org.organizationId, (tx) =>
      tx.query_sets.findFirst({
        where: { organization_id: org.organizationId, brand_id: brand.id, status: 'active', deleted_at: null },
      }),
    );
    if (!querySet) return c.json(NO_ACTIVE_QUERY_SET_ERROR, 404);

    const queries = await withOrgContext(org.organizationId, (tx) =>
      tx.queries.findMany({ where: { query_set_id: querySet.id, deleted_at: null }, select: { id: true } }),
    );
    if (queries.length === 0) {
      return c.json({ error: 'query_set_empty', message: 'The active query set has no queries.' }, 422);
    }

    const providers = getDefaultAiProviderRegistry().resolveNames('geo.query');
    const totalJobs = queries.length * providers.length;

    // Entitlement 1 (Epic 8 addition, this epic's own instruction to reuse
    // Epic 2's competitor-tracking cap): only checked the FIRST time this
    // competitor is run — a competitor already actively tracked can always
    // be re-run (that's just normal re-measurement, not "tracking one
    // more" competitor). See lib/ai-visibility/competitor-usage.ts's doc
    // comment for why this is a distinct counter from
    // routes/competitors.ts's own `competitors_tracked` check.
    const alreadyTracked =
      (await withOrgContext(org.organizationId, (tx) =>
        tx.ai_runs.count({ where: { organization_id: org.organizationId, brand_id: brand.id, competitor_id: competitor.id } }),
      )) > 0;

    if (!alreadyTracked) {
      try {
        await checkUsageLimit(org.organizationId, 'competitors_tracked', () =>
          countTrackedCompetitors(org.organizationId, brand.id),
        );
      } catch (err) {
        if (err instanceof EntitlementLimitError) {
          return c.json(
            {
              error: 'competitor_tracking_limit_reached',
              message: `Your ${err.plan} plan tracks AI-run visibility for up to ${err.limit} competitors (you have ${err.current} actively tracked).${
                err.upgradeTo ? ` Upgrade to ${err.upgradeTo} to track more.` : ''
              }`,
              metric: err.metric,
              limit: err.limit,
              current: err.current,
              plan: err.plan,
              upgradeTo: err.upgradeTo,
            },
            402,
          );
        }
        throw err;
      }
    }

    // Entitlement 2 — identical `ai_queries_per_month` check `routes/ai-runs.ts`
    // applies: a competitor run makes exactly as many real provider calls as
    // a brand run and consumes the same monthly pool
    // (`countAiQueriesThisMonth` sums `ai_runs.total_jobs` org-wide,
    // brand and competitor runs alike).
    try {
      await checkUsageLimit(org.organizationId, 'ai_queries_per_month', () => countAiQueriesThisMonth(org.organizationId), totalJobs);
    } catch (err) {
      if (err instanceof EntitlementLimitError) {
        return c.json(
          {
            error: 'ai_query_limit_reached',
            message: `Your ${err.plan} plan allows up to ${err.limit.toLocaleString()} AI queries per month (this run would use ${totalJobs.toLocaleString()}, and you've already used ${err.current.toLocaleString()} this month).${
              err.upgradeTo ? ` Upgrade to ${err.upgradeTo} for a higher limit.` : ''
            }`,
            metric: err.metric,
            limit: err.limit,
            current: err.current,
            requested: totalJobs,
            plan: err.plan,
            upgradeTo: err.upgradeTo,
          },
          402,
        );
      }
      throw err;
    }

    const run = await withOrgContext(org.organizationId, (tx) =>
      tx.ai_runs.create({
        data: {
          organization_id: org.organizationId,
          brand_id: brand.id,
          competitor_id: competitor.id,
          query_set_id: querySet.id,
          providers,
          status: 'queued',
          total_jobs: totalJobs,
          created_by: user.id,
        },
      }),
    );

    await writeManualAuditEvent(c, { action: 'competitor_ai_run.created', entityType: 'ai_run', entityId: run.id });

    scheduleAiVisibilityRun(run.id, org.organizationId, brand.id);

    return c.json(serializeAiRun(run), 202);
  },
);

export default competitorAiRunsRoute;
