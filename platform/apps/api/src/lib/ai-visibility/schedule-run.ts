/**
 * The PREPARE/QUEUE-to-EXECUTE handoff shared by `routes/ai-runs.ts` (brand
 * runs) and `routes/competitor-ai-runs.ts` (Epic 8 competitor runs) —
 * factored out here so both routes schedule the identical fire-and-forget
 * background job with identical failure handling, rather than two copies of
 * the same job-queue-enqueue/`.catch()` block drifting apart over time.
 *
 * Epic 19 (Production Hardening), item 1: routed through `JobQueue`
 * (`lib/queue/job-queue.ts`) instead of a raw `setImmediate` call — see
 * that module's header comment for the full design. Behaviorally
 * unchanged in this build (the default queue is `InMemoryJobQueue`, which
 * still fires via `setImmediate` under the hood); a process restart
 * mid-run still strands the run in `running` forever with no retry until
 * `default-job-queue.ts` is pointed at `PgBossJobQueue` with a real
 * connection string.
 */
import { withOrgContext } from '@bebest/database';
import { getDefaultJobQueue } from '../queue/default-job-queue.js';
import { runAiVisibilityRun } from './pipeline.js';

interface AiVisibilityRunJobPayload {
  runId: string;
  organizationId: string;
  brandId: string;
}

const JOB_TYPE = 'ai_visibility_run';

getDefaultJobQueue().register<AiVisibilityRunJobPayload>(JOB_TYPE, async ({ runId, organizationId, brandId }) => {
  await runAiVisibilityRun(runId, organizationId, brandId).catch(async (err) => {
    await withOrgContext(organizationId, (tx) =>
      tx.ai_runs.update({
        where: { id: runId },
        data: { status: 'failed', error: String((err as Error)?.message ?? err), completed_at: new Date() },
      }),
    ).catch(() => {
      // Best-effort — if even this write fails, the run is left in
      // whatever state runAiVisibilityRun last successfully wrote.
    });
  });
});

export function scheduleAiVisibilityRun(runId: string, organizationId: string, brandId: string): void {
  void getDefaultJobQueue().enqueue<AiVisibilityRunJobPayload>(JOB_TYPE, { runId, organizationId, brandId });
}
