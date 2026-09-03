/**
 * Shared step used by the GEO and Growth agents: mirrors `routes/
 * ai-runs.ts`'s PREPARE step exactly (entitlement-check `ai_queries_per_month`
 * BEFORE creating the row, snapshot `providers` from the registry, create
 * the `ai_runs` row) and then calls Epic 7's own `runAiVisibilityRun`
 * DIRECTLY — the identical EXECUTE/AGGREGATE pipeline every other caller
 * uses, never reimplemented. The one deliberate difference from the route:
 * `runAiVisibilityRun` is `await`ed in-line rather than scheduled via
 * `setImmediate` — an agent run is ALREADY executing in the background (see
 * `runner.ts`), so there is no HTTP response to unblock by returning early,
 * and awaiting it directly is what lets this step's caller yield real
 * `progress`/`observation` events keyed off the run's ACTUAL completed
 * score, not a synthetic "started" event with no result yet.
 */
import { withOrgContext } from '@bebest/database';
import { checkUsageLimit, EntitlementLimitError } from '../entitlements.js';
import { countAiQueriesThisMonth } from '../ai-visibility/usage.js';
import { getDefaultAiProviderRegistry } from '../ai-visibility/provider-registry.js';
import { runAiVisibilityRun } from '../ai-visibility/pipeline.js';

export type RunAiVisibilityStepResult =
  | { error: 'no_human_trigger' }
  | { error: 'query_set_empty' }
  | { error: 'entitlement'; message: string }
  | { aiRunId: string; aiVisibilityScore: number | null };

export async function runAiVisibilityStep(
  organizationId: string,
  brandId: string,
  querySetId: string,
  triggeredById: string | undefined,
): Promise<RunAiVisibilityStepResult> {
  // `ai_runs.created_by` is a required, human-attributed column (same
  // reasoning as `ensure-query-universe.ts`) — defensive, not reachable via
  // this build's only real (user-triggered) route.
  if (!triggeredById) return { error: 'no_human_trigger' };

  const queries = await withOrgContext(organizationId, (tx) =>
    tx.queries.findMany({ where: { query_set_id: querySetId, deleted_at: null }, select: { id: true } }),
  );
  if (queries.length === 0) return { error: 'query_set_empty' };

  const providers = getDefaultAiProviderRegistry().resolveNames('geo.query');
  const totalJobs = queries.length * providers.length;

  try {
    await checkUsageLimit(organizationId, 'ai_queries_per_month', () => countAiQueriesThisMonth(organizationId), totalJobs);
  } catch (err) {
    if (err instanceof EntitlementLimitError) {
      return {
        error: 'entitlement',
        message: `Your ${err.plan} plan allows up to ${err.limit.toLocaleString()} AI queries per month (this run would use ${totalJobs.toLocaleString()}, and you've already used ${err.current.toLocaleString()} this month).`,
      };
    }
    throw err;
  }

  const run = await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.create({
      data: {
        organization_id: organizationId,
        brand_id: brandId,
        competitor_id: null,
        query_set_id: querySetId,
        providers,
        status: 'queued',
        total_jobs: totalJobs,
        created_by: triggeredById,
      },
    }),
  );

  await runAiVisibilityRun(run.id, organizationId, brandId);

  const completed = await withOrgContext(organizationId, (tx) => tx.ai_runs.findUniqueOrThrow({ where: { id: run.id } }));

  return {
    aiRunId: run.id,
    aiVisibilityScore: completed.ai_visibility_score === null ? null : Number(completed.ai_visibility_score),
  };
}
