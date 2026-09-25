/**
 * A `JobDefinition<TPayload>` with its payload type erased, so a registry can
 * hold jobs of four different payload shapes in one list without `any`.
 *
 * The erasure is safe in exactly one direction and only here: the queue hands
 * a handler whatever payload was enqueued under that job type, and every
 * enqueue site is typed against the same `JobDefinition` the handler came
 * from (`lib/ai-visibility/schedule-run.ts`'s `scheduleAiVisibilityRun`,
 * `lib/crawler/crawl-job.ts`'s `scheduleCrawlJob`, and so on). Nothing
 * downstream of `toRegisteredJob` inspects the payload — the worker's
 * registry only registers it, and the in-flight tracker only carries it back
 * to that same job's own `releaseOnShutdown`.
 */
import type { JobDefinition, JobHandler } from './job-queue.js';

export interface RegisteredJob {
  jobType: string;
  handler: JobHandler<unknown>;
  releaseOnShutdown?: (payload: unknown) => Promise<void>;
}

export function toRegisteredJob<TPayload>(definition: JobDefinition<TPayload>): RegisteredJob {
  return {
    jobType: definition.jobType,
    handler: definition.handler as JobHandler<unknown>,
    releaseOnShutdown: definition.releaseOnShutdown as ((payload: unknown) => Promise<void>) | undefined,
  };
}
