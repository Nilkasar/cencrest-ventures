/**
 * The PREPARE/QUEUE-to-EXECUTE handoff shared by `routes/ai-runs.ts` (brand
 * runs) and `routes/competitor-ai-runs.ts` (Epic 8 competitor runs) —
 * factored out here so both routes schedule the identical background job
 * with identical failure handling, rather than two copies of the same
 * enqueue/`.catch()` block drifting apart over time.
 *
 * This is the job the HTTP/worker split exists for. A baseline run is
 * ~1,400 prompts x 4 models (x competitors) — many thousands of AI calls
 * and hours of wall time. Run in the HTTP process it cannot finish: on
 * Vercel the execution context is frozen the moment the 202 is returned, so
 * the `ai_runs` row stayed `running` forever. With
 * `JOB_QUEUE_DATABASE_URL` configured, `enqueue()` writes a durable pg-boss
 * job and the separate worker process (`src/worker.ts`) runs
 * `aiVisibilityRunJob.handler` with no request lifetime over its head.
 *
 * Two things are deliberate here:
 * - `scheduleAiVisibilityRun` is `async` and its callers AWAIT it. With a
 *   durable queue the enqueue is real I/O (an INSERT); the old
 *   `void enqueue(...)` would let a serverless function return its response
 *   and freeze before Postgres had the row, silently losing the run.
 * - `releaseOnShutdown` marks the run `failed` the same way the handler's
 *   own error path does, so a worker that is SIGTERM'd mid-run leaves a
 *   `failed` row a user can retry instead of a `running` row nothing will
 *   ever finish.
 *
 * COST GATE (added with dollar-based entitlement enforcement):
 * `scheduleAiVisibilityRun` REQUIRES a `RunCostPreflight` — the certificate
 * `lib/ai-usage/cost-entitlements.ts` returns only for a run whose projected
 * model spend fits the org's plan ceilings. It is a required parameter, not a
 * convention, so a future dispatcher physically cannot enqueue an
 * unpriced run: the compiler stops it, and `assertPreflightMatchesOrg` below
 * stops a certificate computed for one org from authorizing another org's
 * run. The money is committed the instant the worker picks the job up, so
 * this is the last point at which refusing is free.
 *
 * The certificate also states the SIZE it priced, and this function checks
 * that the `ai_runs` row records the same one (`PreflightRunSizeMismatchError`)
 * — the enqueue-side half of `lib/ai-usage/priced-run.ts`. The execution-side
 * half lives in `pipeline.ts`, which re-reads the query set live and refuses a
 * set that grew while the job waited in the queue.
 */
import { withOrgContext } from '@bebest/database';
import type { RunCostPreflight } from '../ai-usage/cost-entitlements.js';
import { getDefaultJobQueue } from '../queue/default-job-queue.js';
import { registerInProcessJobHandler } from '../queue/register-in-process.js';
import { JOB_TYPES } from '../queue/job-types.js';
import type { JobDefinition } from '../queue/job-queue.js';
import { runAiVisibilityRun } from './pipeline.js';

export interface AiVisibilityRunJobPayload {
  runId: string;
  organizationId: string;
  brandId: string;
}

/** Best-effort — if even this write fails, the run is left in whatever
 * state `runAiVisibilityRun` last successfully wrote. Always inside
 * `withOrgContext`: the worker connects as `bebest_app` with RLS in force
 * exactly like the API, so `app.current_org` must be set before this
 * touches `ai_runs` at all. */
async function markRunFailed(runId: string, organizationId: string, error: string): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.update({
      where: { id: runId },
      data: { status: 'failed', error, completed_at: new Date() },
    }),
  ).catch(() => {
    // Intentionally swallowed — see above.
  });
}

export const aiVisibilityRunJob: JobDefinition<AiVisibilityRunJobPayload> = {
  jobType: JOB_TYPES.AI_VISIBILITY_RUN,
  handler: async ({ runId, organizationId, brandId }) => {
    await runAiVisibilityRun(runId, organizationId, brandId).catch(async (err) => {
      await markRunFailed(runId, organizationId, String((err as Error)?.message ?? err));
    });
  },
  releaseOnShutdown: async ({ runId, organizationId }) => {
    await markRunFailed(
      runId,
      organizationId,
      'Worker shut down while this run was in progress; the run did not complete. Retry it.',
    );
  },
};

registerInProcessJobHandler(aiVisibilityRunJob);

/** A preflight certificate is per-org. Queueing org B's run on org A's
 * budget check would be a tenant-isolation failure expressed in dollars, so
 * it is asserted rather than trusted — cheap, and it turns a wiring mistake
 * into a loud throw instead of unmetered spend. */
/**
 * The run row does not carry the size this certificate priced — either it was
 * never stamped (`pricedRunColumns()` forgotten by a dispatcher) or it was
 * stamped from a DIFFERENT certificate than the one handed to this function.
 * Both mean the approved figure and the queued work have come apart, which is
 * the whole hole the persisted price exists to close, so it is refused here —
 * at dispatch, loudly — rather than hours later in the worker.
 */
export class PreflightRunSizeMismatchError extends Error {
  constructor(runId: string, certificateQueryCount: number, rowPricedQueryCount: number | null) {
    super(
      `Cost preflight priced ${certificateQueryCount.toLocaleString()} queries but ai_runs ${runId} records ` +
        `${rowPricedQueryCount === null ? 'no priced size at all' : `${rowPricedQueryCount.toLocaleString()}`}; ` +
        'refusing to enqueue. Every dispatcher must stamp pricedRunColumns(<the same certificate>) onto the row it creates.',
    );
    this.name = 'PreflightRunSizeMismatchError';
  }
}

export class PreflightOrgMismatchError extends Error {
  constructor(preflightOrgId: string, organizationId: string) {
    super(
      `Cost preflight was computed for organization ${preflightOrgId} but the run belongs to ${organizationId}; refusing to enqueue.`,
    );
    this.name = 'PreflightOrgMismatchError';
  }
}

export async function scheduleAiVisibilityRun(
  runId: string,
  organizationId: string,
  brandId: string,
  costPreflight: RunCostPreflight,
): Promise<void> {
  if (costPreflight.organizationId !== organizationId) {
    throw new PreflightOrgMismatchError(costPreflight.organizationId, organizationId);
  }

  // The certificate said an ORG and a DOLLAR FIGURE; it now also says a SIZE,
  // and the row has to agree with it before the job goes on the queue. The
  // worker re-checks the size against the LIVE query set (pipeline.ts) — this
  // check is about the row and the certificate matching each other in the
  // first place, so a dispatcher that stamps one price and passes another
  // fails here instead of producing a run nobody priced.
  const row = await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.findUniqueOrThrow({ where: { id: runId }, select: { priced_query_count: true } }),
  );
  if (row.priced_query_count !== costPreflight.pricedQueryCount) {
    throw new PreflightRunSizeMismatchError(runId, costPreflight.pricedQueryCount, row.priced_query_count);
  }

  await getDefaultJobQueue().enqueue<AiVisibilityRunJobPayload>(JOB_TYPES.AI_VISIBILITY_RUN, {
    runId,
    organizationId,
    brandId,
  });
}
