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
 */
import { withOrgContext } from '@bebest/database';
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

export async function scheduleAiVisibilityRun(runId: string, organizationId: string, brandId: string): Promise<void> {
  await getDefaultJobQueue().enqueue<AiVisibilityRunJobPayload>(JOB_TYPES.AI_VISIBILITY_RUN, {
    runId,
    organizationId,
    brandId,
  });
}
