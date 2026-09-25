/**
 * The one function every AI-Visibility dispatcher calls before it creates an
 * `ai_runs` row: shape of the run -> projected dollars -> plan ceilings ->
 * allow or refuse. It exists so the brand route, the competitor route and the
 * agent step cannot drift into three slightly different cost checks (which is
 * exactly how `ai_queries_per_month` ended up enforced in three places with
 * three different error strings).
 *
 * Ordering invariant, inherited from `routes/ai-runs.ts`'s existing
 * entitlement check and deliberately kept identical: this runs BEFORE the
 * `ai_runs` row is created and BEFORE any provider is touched. Refusing after
 * the job is queued would refuse after the money is committed.
 *
 * It reads the UNMETERED registry (`getDefaultAiProviderRegistry`) on
 * purpose: it needs the routing table and each provider's model NAME, and
 * makes no `complete()`/`extract()` call — see
 * `lib/ai-usage/metered-provider.test.ts`'s allowlist, which this file is
 * listed in. It also never calls `healthCheck()`/`resolveAvailable()`, which
 * on Perplexity is itself a billed request.
 */
import type { AIProviderRegistry } from '@bebest/ai-provider';
import { getDefaultAiProviderRegistry } from '../ai-visibility/provider-registry.js';
import {
  describeRunModels,
  estimateAiVisibilityRunCost,
  type RunCostEstimate,
  type RunTokenProfile,
} from './run-cost-estimator.js';
import { checkAiRunCostBudget, type RunCostPreflight } from './cost-entitlements.js';
import type { MicroUsd } from '@bebest/ai-provider';

export interface PreflightAiVisibilityRunInput {
  organizationId: string;
  /** Queries in the active query set — the same count the execution-count
   * entitlement uses, so the two checks can never disagree about run size. */
  queryCount: number;
  /** Injected in tests (a hand-rolled fake registry); production uses the
   * process-wide one. */
  registry?: AIProviderRegistry;
  profile?: Partial<RunTokenProfile>;
  sumSpend?: (organizationId: string) => Promise<MicroUsd>;
  now?: Date;
}

/** Builds the estimate without checking any budget — exported for the
 * subscription/usage surface, which wants to show a customer what a run would
 * cost without refusing anything. */
export function estimateRunForOrg(input: {
  queryCount: number;
  registry?: AIProviderRegistry;
  profile?: Partial<RunTokenProfile>;
}): RunCostEstimate {
  const registry = input.registry ?? getDefaultAiProviderRegistry();
  return estimateAiVisibilityRunCost({
    queryCount: input.queryCount,
    geoModels: describeRunModels(registry, 'geo.query'),
    extractionModels: describeRunModels(registry, 'extraction'),
    profile: input.profile,
  });
}

/** Throws `CostBudgetExceededError` when the run would breach a ceiling;
 * otherwise returns the certificate `scheduleAiVisibilityRun` requires. */
export async function preflightAiVisibilityRunCost(input: PreflightAiVisibilityRunInput): Promise<RunCostPreflight> {
  const estimate = estimateRunForOrg({
    queryCount: input.queryCount,
    registry: input.registry,
    profile: input.profile,
  });

  return checkAiRunCostBudget({
    organizationId: input.organizationId,
    estimate,
    sumSpend: input.sumSpend,
    now: input.now,
  });
}
