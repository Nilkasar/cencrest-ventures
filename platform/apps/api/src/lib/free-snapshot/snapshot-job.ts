/**
 * The free-snapshot background job — extracted out of `routes/snapshot.ts` by
 * the HTTP/worker split.
 *
 * It used to be registered inside `createSnapshotRoutes(emailSender)`, which
 * is why it is the one job whose handler is built by a factory rather than
 * being a module-level constant: the pipeline needs an `EmailSender` to send
 * the "your snapshot is ready" email. The worker gets its sender from the same
 * `createEmailSenderFromEnv()` factory `app.ts` uses, so both processes make
 * the same choice.
 *
 * `snapshot_requests` is NOT a tenant table (no `organization_id` — a free
 * snapshot has no organization yet), so it is the one job whose failure write
 * correctly uses `db` directly rather than `withOrgContext`. Everything the
 * pipeline does that IS tenant-scoped (the `ai_usage` rows it writes, charged
 * to `CRM_INTERNAL_ORG_ID`) goes through `withOrgContext` inside the pipeline
 * itself.
 */
import { db } from '@bebest/database';
import { getDefaultJobQueue } from '../queue/default-job-queue.js';
import { registerInProcessJobHandler } from '../queue/register-in-process.js';
import { JOB_TYPES } from '../queue/job-types.js';
import type { JobDefinition } from '../queue/job-queue.js';
import type { EmailSender } from '../email.js';
import { runFreeSnapshotPipeline, type FreeSnapshotInput } from './orchestrator.js';

export interface FreeSnapshotJobPayload {
  snapshotRequestId: string;
  token: string;
  input: FreeSnapshotInput;
}

export function createFreeSnapshotJob(emailSender: EmailSender): JobDefinition<FreeSnapshotJobPayload> {
  return {
    jobType: JOB_TYPES.FREE_SNAPSHOT,
    handler: async ({ snapshotRequestId, token, input }) => {
      await runFreeSnapshotPipeline(snapshotRequestId, token, input, { emailSender }).catch((err: unknown) => {
        // runFreeSnapshotPipeline already catches everything internally and
        // marks the row `failed` — this is a final backstop in case
        // something outside that try/catch (e.g. a synchronous throw before
        // its own try block) escapes.
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'free_snapshot_pipeline_uncaught',
            snapshotRequestId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    },
    releaseOnShutdown: async ({ snapshotRequestId }) => {
      await db.snapshot_requests
        .update({
          where: { id: snapshotRequestId },
          data: {
            status: 'failed',
            result_json: {
              error: 'Worker shut down while this snapshot was being prepared; it did not complete.',
            },
          },
        })
        .catch(() => {
          // Best-effort, same posture as the orchestrator's own markFailed.
        });
    },
  };
}

/** Called by `createSnapshotRoutes` so single-process dev/test keeps firing
 * the pipeline in-process; a no-op once a separate worker is configured. */
export function registerFreeSnapshotJobInProcess(emailSender: EmailSender): void {
  registerInProcessJobHandler(createFreeSnapshotJob(emailSender));
}

export async function scheduleFreeSnapshot(payload: FreeSnapshotJobPayload): Promise<void> {
  await getDefaultJobQueue().enqueue<FreeSnapshotJobPayload>(JOB_TYPES.FREE_SNAPSHOT, payload);
}
