/**
 * THE VALVE. Dollar-based entitlement enforcement — the half of cost control
 * that `lib/entitlements.ts` structurally cannot do.
 *
 * `checkUsageLimit` compares an Int row count to an Int plan limit. That is
 * the right tool for "how many competitors" and the wrong one for money:
 * `plans.limits`' dollar ceilings are fractional, actual spend lives in
 * `ai_usage.cost_usd` (`Decimal(10,6)`), and a count-based cap cannot tell a
 * $0.0002 Gemini Flash call from a $0.04 Opus call. So this module follows
 * `checkUsageLimit`'s ESTABLISHED PATTERN — resolve the plan's limits, let
 * the caller supply the "current" figure, throw a specific error naming the
 * limit and the upgrade path, never return a boolean a caller can forget to
 * check — while doing its arithmetic in exact BigInt micro-dollars.
 *
 * WHY NOT `usage_records`: it is `quantity Int` keyed by the `usage_metric`
 * enum (`prompt_runs | ai_tokens | crawl_pages | users | brands`). There is
 * no dollar metric in that enum, an `Int` cannot hold micro-dollars, and
 * nothing in `apps/api/src` writes the table at all — so a budget built on
 * it would read 0 forever and refuse nothing. `ai_usage` is written on every
 * model call and is the only place real cost exists. See `spend.ts`.
 *
 * TWO CEILINGS, deliberately:
 *   - `max_cost_per_run_usd` stops ONE mis-sized dispatch (a 5,000-query
 *     universe x 4 frontier models) from eating the month in a single click.
 *     Checked against the PROJECTED cost alone, so it is enforceable on an
 *     org with zero spend history.
 *   - `ai_cost_budget_usd_per_month` stops the slow leak — many individually
 *     reasonable runs. Checked against month-to-date ACTUAL spend plus the
 *     projection.
 * Per-run is checked FIRST so the error a customer sees names the thing they
 * can act on (shrink the run) rather than the thing they cannot (wait for
 * the month to roll over).
 */
import { resolvePlanLimits, nextTierUp, type PlanTier, type CostPlanLimitKey } from '../entitlements.js';
import { formatMicroUsd, parseDecimalToScaled, type MicroUsd } from '@bebest/ai-provider';
import { sumOrgAiSpendThisMonth } from './spend.js';
import type { RunCostEstimate } from './run-cost-estimator.js';

/**
 * A dollar ceiling from `plans.limits` -> exact micro-dollars.
 *
 * JSONB gives us whatever was seeded: a JS number (`600`), or a string
 * (`"600.50"`) if a future admin surface writes one. Numbers go through
 * `toFixed(6)` so no float ever reaches the BigInt, and anything
 * unparseable resolves to `null` — "no ceiling configured" — rather than
 * throwing on the refusal path. A malformed ceiling failing OPEN is a
 * deliberate choice: the alternative is every run in the org 500-ing on a
 * typo in a plans row, which is a worse outage than a temporarily
 * unenforced cap, and `logUnparseableCeiling` makes it loud.
 */
export function parseUsdCeilingToMicros(value: unknown, context: string): MicroUsd | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return logUnparseableCeiling(value, context);
    text = value.toFixed(6);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return logUnparseableCeiling(value, context);
  }
  try {
    return parseDecimalToScaled(text, 6);
  } catch {
    return logUnparseableCeiling(value, context);
  }
}

function logUnparseableCeiling(value: unknown, context: string): null {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'cost_ceiling_unparseable',
      context,
      value: String(value),
      hint: 'a plans.limits dollar ceiling is malformed — it is being treated as UNLIMITED until fixed',
    }),
  );
  return null;
}

/**
 * Thrown when a run's projected cost breaches a dollar ceiling. Carries
 * everything a route needs to answer with a specific 402 (the projected
 * number AND the remaining budget — a refusal that does not tell the
 * customer how much room they have is a support ticket), in both exact
 * micro-dollars and display strings.
 */
export class CostBudgetExceededError extends Error {
  constructor(
    public readonly ceiling: CostPlanLimitKey,
    public readonly plan: PlanTier,
    public readonly limitMicros: MicroUsd,
    /** Month-to-date actual spend. Always 0n for the per-run ceiling, which
     * does not consider history. */
    public readonly currentMicros: MicroUsd,
    public readonly projectedMicros: MicroUsd,
    public readonly upgradeTo: PlanTier | null,
    public readonly estimate: RunCostEstimate,
  ) {
    super(
      `${ceiling} ($${formatMicroUsd(limitMicros)}) would be exceeded on the ${plan} plan: ` +
        `projected $${formatMicroUsd(projectedMicros)}, already spent $${formatMicroUsd(currentMicros)} this month`,
    );
    this.name = 'CostBudgetExceededError';
  }

  get limitUsd(): string {
    return formatMicroUsd(this.limitMicros);
  }
  get currentUsd(): string {
    return formatMicroUsd(this.currentMicros);
  }
  get projectedUsd(): string {
    return formatMicroUsd(this.projectedMicros);
  }
  /** Never negative — a customer already over budget sees $0.000000 left,
   * not a negative number. */
  get remainingUsd(): string {
    const remaining = this.limitMicros - this.currentMicros;
    return formatMicroUsd(remaining > 0n ? remaining : 0n);
  }
}

/**
 * PROOF THAT A RUN WAS COST-CHECKED.
 *
 * `scheduleAiVisibilityRun` requires one of these, so a new caller cannot
 * enqueue a run without having gone through the check — the compiler enforces
 * the invariant instead of a comment asking the next person to remember. It
 * carries `organizationId` so the schedule path can verify the certificate
 * belongs to the org it is queueing for: a preflight computed against org A's
 * budget must never authorize a run for org B.
 */
export interface RunCostPreflight {
  readonly checked: true;
  readonly organizationId: string;
  readonly plan: PlanTier;
  readonly projectedMicros: MicroUsd;
  readonly projectedUsd: string;
  readonly monthToDateMicros: MicroUsd;
  readonly monthlyBudgetMicros: MicroUsd | null;
  readonly perRunCeilingMicros: MicroUsd | null;
  /** `null` when no monthly budget is configured (unlimited tier). */
  readonly remainingMicros: MicroUsd | null;
  readonly estimate: RunCostEstimate;
}

export interface CheckAiRunCostBudgetInput {
  organizationId: string;
  estimate: RunCostEstimate;
  /** Injected in tests; production reads `ai_usage` through RLS. */
  sumSpend?: (organizationId: string) => Promise<MicroUsd>;
  now?: Date;
}

/**
 * Refuses a run that would breach either dollar ceiling; returns the
 * certificate `scheduleAiVisibilityRun` demands when it fits.
 *
 * Resolves silently-with-a-value (never a boolean) and throws
 * `CostBudgetExceededError` on refusal, the same contract
 * `checkUsageLimit`/`EntitlementLimitError` established so a route handler
 * cannot accidentally ignore the outcome.
 *
 * An UNPRICED model in the estimate is treated as a refusal condition when a
 * ceiling is set: the estimate is then knowingly an under-count, and
 * certifying "this fits in your budget" from a number we know is too low is
 * exactly the false assurance this module exists to stop. An org with no
 * ceilings configured (managed/enterprise) is unaffected — there is nothing
 * to be wrong about.
 */
export async function checkAiRunCostBudget(input: CheckAiRunCostBudgetInput): Promise<RunCostPreflight> {
  const { plan, limits } = await resolvePlanLimits(input.organizationId);

  const perRunCeiling = parseUsdCeilingToMicros(
    limits.max_cost_per_run_usd,
    `plan=${plan} key=max_cost_per_run_usd`,
  );
  const monthlyBudget = parseUsdCeilingToMicros(
    limits.ai_cost_budget_usd_per_month,
    `plan=${plan} key=ai_cost_budget_usd_per_month`,
  );

  const projected = input.estimate.micros;
  const upgradeTo = nextTierUp(plan);

  if (perRunCeiling === null && monthlyBudget === null) {
    // No ceilings on this tier — nothing to enforce, and no reason to spend a
    // query summing spend we will not compare against.
    return {
      checked: true,
      organizationId: input.organizationId,
      plan,
      projectedMicros: projected,
      projectedUsd: formatMicroUsd(projected),
      monthToDateMicros: 0n,
      monthlyBudgetMicros: null,
      perRunCeilingMicros: null,
      remainingMicros: null,
      estimate: input.estimate,
    };
  }

  if (input.estimate.unpricedModels.length > 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'run_cost_estimate_has_unpriced_models',
        organizationId: input.organizationId,
        plan,
        models: input.estimate.unpricedModels,
        hint: 'add these models to packages/ai-provider/src/pricing.ts — the run is refused because its projected cost is knowingly an under-count',
      }),
    );
    throw new CostBudgetExceededError(
      'max_cost_per_run_usd',
      plan,
      perRunCeiling ?? 0n,
      0n,
      projected,
      upgradeTo,
      input.estimate,
    );
  }

  // Per-run ceiling first — see this module's header.
  if (perRunCeiling !== null && projected > perRunCeiling) {
    throw new CostBudgetExceededError('max_cost_per_run_usd', plan, perRunCeiling, 0n, projected, upgradeTo, input.estimate);
  }

  const sumSpend = input.sumSpend ?? ((orgId: string) => sumOrgAiSpendThisMonth(orgId, input.now));
  const monthToDate = monthlyBudget === null ? 0n : await sumSpend(input.organizationId);

  if (monthlyBudget !== null && monthToDate + projected > monthlyBudget) {
    throw new CostBudgetExceededError(
      'ai_cost_budget_usd_per_month',
      plan,
      monthlyBudget,
      monthToDate,
      projected,
      upgradeTo,
      input.estimate,
    );
  }

  return {
    checked: true,
    organizationId: input.organizationId,
    plan,
    projectedMicros: projected,
    projectedUsd: formatMicroUsd(projected),
    monthToDateMicros: monthToDate,
    monthlyBudgetMicros: monthlyBudget,
    perRunCeilingMicros: perRunCeiling,
    remainingMicros: monthlyBudget === null ? null : maxZero(monthlyBudget - monthToDate),
    estimate: input.estimate,
  };
}

function maxZero(v: MicroUsd): MicroUsd {
  return v > 0n ? v : 0n;
}

/** The 402 body shape every caller returns for a cost refusal, so the brand
 * route, the competitor route and any future dispatcher answer identically.
 * Mirrors the existing `ai_query_limit_reached` body's field names
 * (`limit`/`current`/`requested`/`plan`/`upgradeTo`) with dollars alongside. */
export function costRefusalBody(err: CostBudgetExceededError): Record<string, unknown> {
  const perRun = err.ceiling === 'max_cost_per_run_usd';
  return {
    error: 'ai_cost_budget_exceeded',
    message: perRun
      ? `This run's projected AI model cost is $${err.projectedUsd}, which exceeds the ${err.plan} plan's $${err.limitUsd} per-run ceiling. Reduce the query set or the number of models.${
          err.upgradeTo ? ` Upgrade to ${err.upgradeTo} for a higher ceiling.` : ''
        }`
      : `This run's projected AI model cost is $${err.projectedUsd}, but only $${err.remainingUsd} of the ${err.plan} plan's $${err.limitUsd} monthly AI budget remains (you have spent $${err.currentUsd} this month).${
          err.upgradeTo ? ` Upgrade to ${err.upgradeTo} for a higher budget.` : ''
        }`,
    metric: err.ceiling,
    plan: err.plan,
    upgradeTo: err.upgradeTo,
    limit_usd: err.limitUsd,
    current_usd: err.currentUsd,
    projected_usd: err.projectedUsd,
    remaining_usd: err.remainingUsd,
    projected_calls: err.estimate.totalCalls,
    pricing_table_version: err.estimate.pricingTableVersion,
  };
}
