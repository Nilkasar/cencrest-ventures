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
