/**
 * The single canonical list of every job type this system can enqueue.
 *
 * Why this file exists: `apps/api` is deployed twice from one codebase —
 * once as Vercel serverless functions that only ever ENQUEUE (see
 * `apps/api/vercel.json` + `apps/api/api/index.js`), and once as the
 * persistent worker process (`src/worker.ts`) that only ever CONSUMES.
 * Split that way, "module X registers its handler at import time" stops
 * being a guarantee: the HTTP process imports the route and the worker may
 * not import the module at all.
 *
 * So the job type itself is declared here, in a module with no imports and
 * no side effects, and BOTH sides are checked against it:
 * - every `enqueue()` call site must name its job type as `JOB_TYPES.*`
 *   (enforced by a source scan in `job-registry.test.ts`, so a new job type
 *   that is enqueued but never declared/consumed fails the suite);
 * - `registerAllJobHandlers()` (see `job-registry.ts`) refuses to start the
 *   worker unless a handler exists for every entry below.
 *
 * Adding a job type is therefore a three-step change that cannot silently
 * half-land: add it here, add its `JobDefinition` to `job-registry.ts`, and
 * enqueue it with `JOB_TYPES.<NAME>`.
 */
export const JOB_TYPES = {
  /** `lib/ai-visibility/schedule-run.ts` — the flagship baseline/competitor
   * AI Visibility run (~1,400 prompts x 4 models; hours of wall time). */
  AI_VISIBILITY_RUN: 'ai_visibility_run',
  /** `lib/crawler/crawl-job.ts` — the website crawl behind Epic 3. */
  CRAWL: 'crawl_job',
  /** `lib/agents/runner.ts` — one agent run (GEO/SEO/Growth). */
  AGENT_RUN: 'agent_run',
  /** `lib/free-snapshot/snapshot-job.ts` — the public free-snapshot
   * pipeline (Epic 17). */
  FREE_SNAPSHOT: 'free_snapshot_pipeline',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/** Every declared job type, in declaration order. The worker must have a
 * handler for all of these; `registerAllJobHandlers()` asserts it. */
export const ALL_JOB_TYPES: readonly JobType[] = Object.freeze(Object.values(JOB_TYPES)) as readonly JobType[];

export function isKnownJobType(value: string): value is JobType {
  return (ALL_JOB_TYPES as readonly string[]).includes(value);
}

/**
 * How long a job of each type may run, and whether the queue may retry it on
 * its own.
 *
 * `expireInSeconds` matters enormously here and pg-boss's default (15 minutes)
 * is catastrophically wrong for this workload: a job still `active` past it is
 * considered dead and handed to another worker. An AI Visibility baseline run
 * is ~1,400 prompts x 4 models and takes HOURS, so on the default it would be
 * re-dispatched every 15 minutes while the first attempt was still running —
 * several concurrent pipelines writing the same run, at several times the AI
 * spend. Every long job therefore declares a realistic ceiling.
 *
 * `retryLimit: 0` on the three expensive jobs is deliberate, not timidity.
 * Nothing in this build can resume a partially-completed run, so an automatic
 * retry means re-running thousands of billed AI calls from scratch, and for an
 * agent run it could re-execute actions already taken against a customer's
 * site. A failed run is marked `failed` by its own handler (and by
 * `releaseOnShutdown` if the worker was killed), which is a state the product
 * can show and a human can knowingly retry. The free snapshot is the
 * exception: it is small, cheap, lead-facing, and worth one automatic retry.
 */
export interface JobPolicy {
  /** Seconds a job may stay `active` before pg-boss treats the worker as dead
   * and re-dispatches or fails it. */
  expireInSeconds: number;
  /** Automatic retries AFTER the first attempt. */
  retryLimit: number;
}

const HOURS = 3600;

export const JOB_POLICIES: Record<JobType, JobPolicy> = {
  // ~1,400 prompts x 4 models x (brand + competitors), rate-limited per
  // provider. Six hours is a ceiling, not an expectation.
  [JOB_TYPES.AI_VISIBILITY_RUN]: { expireInSeconds: 6 * HOURS, retryLimit: 0 },
  // Max 500 pages at max 2 req/sec, plus per-page parsing (docs/08-security).
  [JOB_TYPES.CRAWL]: { expireInSeconds: 2 * HOURS, retryLimit: 0 },
  [JOB_TYPES.AGENT_RUN]: { expireInSeconds: 2 * HOURS, retryLimit: 0 },
  // 20-50 queries x 4 models plus a small crawl — minutes, not hours.
  [JOB_TYPES.FREE_SNAPSHOT]: { expireInSeconds: 1 * HOURS, retryLimit: 1 },
};
