import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { checkUsageLimit, EntitlementLimitError } from '../lib/entitlements.js';
import { countAiQueriesThisMonth } from '../lib/ai-visibility/usage.js';
import { getDefaultAiProviderRegistry } from '../lib/ai-visibility/provider-registry.js';
import { runAiVisibilityRun } from '../lib/ai-visibility/pipeline.js';
import { serializeAiRun } from '../lib/ai-visibility/serialize.js';
import type { AppEnv } from '../types/context.js';

const aiRunsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
// docs/08-security/SECURITY.md's permission matrix already has
// `run_ai_analysis` (owner/admin/analyst) — kicking off an AI Visibility
// run is exactly that action, not a new permission this epic needs to add.
const RUN = 'run_ai_analysis' as const;

// ── GET / — list the brand's AI runs, newest first (history preserved —
// re-running the same query_set creates a NEW row, never overwrites one;
// see the epic's end-to-end flow step 6) ────────────────────────────────
aiRunsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.ai_runs.findMany({
      where: { organization_id: org.organizationId, brand_id: brand.id },
      orderBy: { created_at: 'desc' },
    }),
  );

  return c.json(rows.map(serializeAiRun));
});

const NO_ACTIVE_QUERY_SET_ERROR = {
  error: 'no_active_query_set',
  message: 'This brand has no active query set. Generate and activate one first via /api/brands/me/query-sets.',
} as const;

// ── POST / — PREPARE + QUEUE: entitlement-check, create the ai_runs row,
// schedule EXECUTE/AGGREGATE in the background. Mirrors routes/crawl.ts's
// synchronous-row-then-setImmediate shape exactly. ──────────────────────
aiRunsRoute.post('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(RUN), async (c) => {
  const org = c.get('org');
  const user = c.get('user');

  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

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

  // docs/12-ai/AI_ARCHITECTURE.md's routing table, via the SAME registry
  // resolution logic every other consumer of `@bebest/ai-provider` uses
  // (never a hand-copied literal array here) — 'geo.query' fans out to all
  // four cloud providers and NEVER Ollama; see
  // lib/ai-visibility/pipeline.test.ts for the regression test proving the
  // pipeline itself also never substitutes Ollama for a GEO-query job.
  const providers = getDefaultAiProviderRegistry().resolveNames('geo.query');
  const totalJobs = queries.length * providers.length;

  // Entitlement check BEFORE any provider is called and BEFORE the
  // ai_runs row is even created — the epic's end-to-end flow step 1's
  // literal invariant.
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
        query_set_id: querySet.id,
        providers,
        status: 'queued',
        total_jobs: totalJobs,
        created_by: user.id,
      },
    }),
  );

  await writeManualAuditEvent(c, { action: 'ai_run.created', entityType: 'ai_run', entityId: run.id });

  // TODO: replace with durable queue (pg-boss) — same documented,
  // no-queue-package-in-this-monorepo placeholder routes/crawl.ts already
  // uses (checked again at this epic's spec time: still true). A process
  // restart mid-run currently strands it in `running` forever with no
  // retry — tracked in the backend doc's "not done" list, not solved here.
  setImmediate(() => {
    void runAiVisibilityRun(run.id, org.organizationId, brand.id).catch(async (err) => {
      await withOrgContext(org.organizationId, (tx) =>
        tx.ai_runs.update({
          where: { id: run.id },
          data: { status: 'failed', error: String((err as Error)?.message ?? err), completed_at: new Date() },
        }),
      ).catch(() => {
        // Best-effort — if even this write fails, the run is left in
        // whatever state runAiVisibilityRun last successfully wrote.
      });
    });
  });

  return c.json(serializeAiRun(run), 202);
});

export default aiRunsRoute;
