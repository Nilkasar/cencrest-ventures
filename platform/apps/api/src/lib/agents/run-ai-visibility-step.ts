/**
 * Shared step used by the GEO and Growth agents: mirrors `routes/
 * ai-runs.ts`'s PREPARE step exactly (entitlement-check `ai_queries_per_month`
 * BEFORE creating the row, snapshot `providers` from the registry, create
 * the `ai_runs` row) and then calls Epic 7's own `runAiVisibilityRun`
 * DIRECTLY — the identical EXECUTE/AGGREGATE pipeline every other caller
 * uses, never reimplemented. The one deliberate difference from the route:
 * `runAiVisibilityRun` is `await`ed in-line rather than scheduled via the
 * `JobQueue` (`lib/queue/job-queue.ts`) — an agent run is ALREADY executing in the background (see
 * `runner.ts`), so there is no HTTP response to unblock by returning early,
 * and awaiting it directly is what lets this step's caller yield real
 * `progress`/`observation` events keyed off the run's ACTUAL completed
 * score, not a synthetic "started" event with no result yet.
 */
import { withOrgContext } from '@bebest/database';
import { checkUsageLimit, EntitlementLimitError } from '../entitlements.js';
import { countPromptModelExecutionsThisMonth } from '../ai-visibility/usage.js';
import { preflightAiVisibilityRunCost } from '../ai-usage/run-preflight.js';
import { pricedRunColumns } from '../ai-usage/priced-run.js';
import { CostBudgetExceededError } from '../ai-usage/cost-entitlements.js';
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
    await checkUsageLimit(
      organizationId,
      'prompt_model_executions_per_month',
      () => countPromptModelExecutionsThisMonth(organizationId),
      totalJobs,
    );
  } catch (err) {
    if (err instanceof EntitlementLimitError) {
      return {
        error: 'entitlement',
        message: `Your ${err.plan} plan allows up to ${err.limit.toLocaleString()} prompt-model executions per month (this run would use ${totalJobs.toLocaleString()}, and you've already used ${err.current.toLocaleString()} this month).`,
      };
    }
    throw err;
  }

  // The dollar valve. An AGENT dispatching a run is the one caller with no
  // human watching the 402, so it matters more here, not less: without this,
  // an autonomous GEO/Growth agent on a schedule is an unbounded spender.
  // This step calls `runAiVisibilityRun` directly instead of going through
  // `scheduleAiVisibilityRun`, so the certificate is never checked by the
  // enqueue path — the check here, plus the approved size stamped onto the row
  // below, is the gate. The pipeline refuses any run whose row carries no
  // price, so this step cannot skip the stamp and still execute.
  let costPreflight;
  try {
    costPreflight = await preflightAiVisibilityRunCost({ organizationId, queryCount: queries.length });
  } catch (err) {
    if (err instanceof CostBudgetExceededError) {
      return { error: 'entitlement', message: err.message };
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
        ...pricedRunColumns(costPreflight),
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
