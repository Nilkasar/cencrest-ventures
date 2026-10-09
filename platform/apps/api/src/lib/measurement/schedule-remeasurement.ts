/**
 * Epic 14 (Measurement & Learning Loop) — the 4-week re-measurement trigger,
 * now a real queue job.
 *
 * It used to be chained `.unref()`d `setTimeout` calls in whatever process
 * handled the approval request. That was honest when one long-lived process
 * served requests and ran background work, and it is simply broken under the
 * HTTP/worker split: the approval is served by a Vercel serverless function
 * that is frozen seconds after its response returns, so the timer never fires.
 * Nothing errored — the re-measurement just never happened, which is the worst
 * possible failure mode for the one feature whose entire job is proving whether
 * a change worked.
 *
 * The whole 32-bit `setTimeout` ceiling problem disappears with it. `delayMs`
 * of four weeks (2,419,200,000) exceeds the ~24.8-day signed-int limit that
 * silently clamps a timer to 1ms, so the old implementation needed chunked
 * re-scheduling to avoid firing almost immediately. pg-boss stores the delay as
 * a row in Postgres and has no such ceiling, so that machinery is gone rather
 * than ported.
 *
 * `runMeasurementForAction` handles every EXPECTED failure internally without
 * throwing (no before-score, no active query set, no crawl data, an entitlement
 * limit — see that module's doc comment). The handler here catches what it
 * doesn't, so a genuinely unexpected failure is logged rather than escaping into
 * the queue's generic wrapper. There is no `releaseOnShutdown`: unlike a crawl
 * or a visibility run there is no domain row sitting in an in-progress state
 * that a shutdown would strand, and the job carries `retryLimit: 1` so a worker
 * killed mid-measurement gets one more attempt.
 */
import { getDefaultJobQueue } from '../queue/default-job-queue.js';
import { registerInProcessJobHandler } from '../queue/register-in-process.js';
import { JOB_TYPES } from '../queue/job-types.js';
import type { JobDefinition } from '../queue/job-queue.js';
import { runMeasurementForAction } from './run-measurement.js';

export const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

export interface RemeasurementPayload {
  actionId: string;
  organizationId: string;
}

export const remeasurementJob: JobDefinition<RemeasurementPayload> = {
  jobType: JOB_TYPES.REMEASUREMENT,
  handler: async ({ actionId, organizationId }) => {
    await runMeasurementForAction(organizationId, actionId).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'remeasurement_failed',
          actionId,
          organizationId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  },
};

registerInProcessJobHandler(remeasurementJob);

/**
 * Schedules exactly one re-measurement for `actionId`, four weeks out.
 *
 * Awaited by its caller: with a durable queue the enqueue is a real INSERT, and
 * a serverless function that returns before it lands loses the job — the same
 * reason every other scheduler in this codebase is awaited.
 *
 * `delayMs` is injectable so a test can exercise the real enqueue path without
 * asserting against a four-week constant.
 */
export async function scheduleRemeasurement(
  actionId: string,
  organizationId: string,
  options: { delayMs?: number } = {},
): Promise<void> {
  await getDefaultJobQueue().enqueue<RemeasurementPayload>(
    JOB_TYPES.REMEASUREMENT,
    { actionId, organizationId },
    { delayMs: options.delayMs ?? FOUR_WEEKS_MS },
  );
}
