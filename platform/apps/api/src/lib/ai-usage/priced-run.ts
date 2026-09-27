/**
 * THE BRIDGE BETWEEN "PRICED" AND "EXECUTED".
 *
 * `lib/ai-usage/run-preflight.ts` prices a run and refuses it if it breaches a
 * plan ceiling. But it prices the query set as it exists at DISPATCH time,
 * while `lib/ai-visibility/pipeline.ts` re-reads that set LIVE when the worker
 * picks the job up — potentially hours later, after a queue backlog, a worker
 * restart, or a `releaseOnShutdown` retry. Nothing connected those two
 * moments: the certificate stated an org and a dollar figure, never a size, so
 * a set that grew between them executed against an approval that had priced
 * something smaller. The spend valve held at the door and not at the till.
 *
 * Two halves, deliberately in one module so they cannot drift:
 *
 *   - `pricedRunColumns()` — what every dispatcher writes onto the `ai_runs`
 *     row: the approved size, the projected cost, and the pricing-table
 *     version that produced it. Three dispatchers exist
 *     (`routes/ai-runs.ts`, `routes/competitor-ai-runs.ts`,
 *     `lib/agents/run-ai-visibility-step.ts`); they all take the SAME
 *     certificate object and turn it into the SAME columns here rather than
 *     each spelling out a `data:` fragment.
 *
 *   - `assertRunWithinPricedSize()` — what execution checks before it spends
 *     anything. A run whose live set is LARGER than the approved size is
 *     refused outright; a run carrying no approval at all is refused too
 *     (see `RunNotPricedError` — fail closed, because "no recorded price"
 *     and "priced at zero" are indistinguishable otherwise).
 *
 * A set that SHRANK is allowed through: the executed work is then strictly
 * cheaper than what was approved, which is the direction a spend ceiling
 * exists to permit. The projected cost stays on the row as the figure that
 * was approved, not a claim about what was ultimately spent — real spend is
 * `ai_usage`, joined by org and time.
 *
 * WHAT THIS IS NOT: continuous, mid-run enforcement. Once a run of an
 * approved size starts, it runs to completion; a per-call budget check while
 * 5,600 jobs are in flight is a separate design (and a separate epic). This
 * closes the gap between the price and the START of execution, which is where
 * the size can change behind the valve's back.
 */
import { formatMicroUsd, type MicroUsd } from '@bebest/ai-provider';
import type { RunCostPreflight } from './cost-entitlements.js';

/** The `ai_runs` columns a dispatcher must write for the run to be
 * executable. Shaped as a Prisma `data:` fragment so a create site can spread
 * it directly and cannot half-populate it. */
export interface PricedRunColumns {
  priced_query_count: number;
  projected_cost_micro_usd: bigint;
  cost_pricing_table_version: string;
}

export function pricedRunColumns(preflight: RunCostPreflight): PricedRunColumns {
  return {
    priced_query_count: preflight.pricedQueryCount,
    // BIGINT micro-dollars, not Decimal: this is the exact `MicroUsd` the
    // valve compared against the plan ceiling, stored without a float or a
    // rounding step between the two. `formatMicroUsd` renders it for display.
    projected_cost_micro_usd: preflight.projectedMicros,
    cost_pricing_table_version: preflight.estimate.pricingTableVersion,
  };
}

/** The subset of an `ai_runs` row this guard reads. Structural, so the
 * pipeline can pass its already-loaded row and tests can pass a literal. */
export interface PricedRunRow {
  id: string;
  priced_query_count: number | null;
  projected_cost_micro_usd: bigint | null;
}

/**
 * A run row with no recorded price. Fail-closed on purpose: the alternative
 * is a dispatcher that forgets `pricedRunColumns()` producing runs that spend
 * freely while every ceiling reports itself enforced.
 */
export class RunNotPricedError extends Error {
  constructor(public readonly runId: string) {
    super(
      `Run ${runId} carries no cost preflight (priced_query_count is null); refusing to execute it. ` +
        'Every dispatcher must stamp pricedRunColumns() onto the ai_runs row at create time.',
    );
    this.name = 'RunNotPricedError';
  }
}

/**
 * The live query set is bigger than the one the plan ceiling approved. The
 * message names both numbers and the approved dollar figure, because this is
 * what ends up in `ai_runs.error` and it is the only place a human will see
 * why the run stopped.
 */
export class RunSizeExceedsPricedError extends Error {
  constructor(
    public readonly runId: string,
    public readonly pricedQueryCount: number,
    public readonly actualQueryCount: number,
    public readonly projectedMicros: MicroUsd | null,
  ) {
    super(
      `Run ${runId} was priced for ${pricedQueryCount.toLocaleString()} queries ` +
        `(projected $${projectedMicros === null ? 'unknown' : formatMicroUsd(projectedMicros)}) ` +
        `but its query set now holds ${actualQueryCount.toLocaleString()}. ` +
        'Refusing to execute work that was never cost-approved — re-run it so the larger set is priced against the plan ceiling.',
    );
    this.name = 'RunSizeExceedsPricedError';
  }
}

/**
 * Throws unless the work about to be performed fits inside what was priced.
 * Pure — no I/O, no clock — so the caller decides how the refusal is
 * recorded (`pipeline.ts` marks the run `failed` with the message BEFORE
 * rethrowing, so the failure lives in the run row and not only in a log).
 */
export function assertRunWithinPricedSize(run: PricedRunRow, actualQueryCount: number): void {
  if (run.priced_query_count === null) throw new RunNotPricedError(run.id);
  if (actualQueryCount > run.priced_query_count) {
    throw new RunSizeExceedsPricedError(
      run.id,
      run.priced_query_count,
      actualQueryCount,
      run.projected_cost_micro_usd,
    );
  }
}
