/**
 * The ONE place that knows every job handler — imported by the worker
 * entrypoint (`src/worker.ts`) and by nothing on the HTTP path.
 *
 * This is the registration story the HTTP/worker split needs. Before the
 * split, each job module called `getDefaultJobQueue().register(...)` at
 * import time and the single process that served the request also ran the
 * job. Split, that is wrong in both directions: the Vercel HTTP process would
 * register handlers it can never run (its context is frozen when the response
 * returns), and the worker would consume nothing unless it happened to import
 * every module that registers something — a silent, invisible failure whose
 * only symptom is a row stuck in `running`.
 *
 * So:
 * - `job-types.ts` declares every job type, with no imports and no side
 *   effects, and is the list both sides are checked against.
 * - This module maps each declared type to its handler, and
 *   `registerAllJobHandlers()` REFUSES to proceed unless every declared type
 *   has exactly one. The worker calls it before `queue.start()`, so a job
 *   type someone adds an enqueue for but forgets to add a handler for stops
 *   the worker at boot with a message naming it, instead of quietly dropping
 *   that customer's work.
 * - `job-registry.test.ts` additionally scans the source tree for `enqueue()`
 *   call sites, so the same mistake fails CI before it can reach a deploy.
 */
import type { JobDefinition, JobQueue } from './job-queue.js';
import { ALL_JOB_TYPES } from './job-types.js';
import { toRegisteredJob, type RegisteredJob } from './registered-job.js';
import { InFlightJobTracker } from './in-flight-jobs.js';
import { createEmailSenderFromEnv, type EmailSender } from '../email.js';
import { aiVisibilityRunJob } from '../ai-visibility/schedule-run.js';
import { crawlJob } from '../crawler/crawl-job.js';
import { agentRunJob } from '../agents/runner.js';
import { createFreeSnapshotJob } from '../free-snapshot/snapshot-job.js';
import { remeasurementJob } from '../measurement/schedule-remeasurement.js';

export interface JobRegistryDeps {
  /** The free-snapshot pipeline needs a sender to email the finished report.
   * Defaults to the same env-driven factory `app.ts` uses, so the worker and
   * the API never disagree about whether email is real. */
  emailSender?: EmailSender;
}

/** Every job this process can consume, in `job-types.ts` declaration order. */
export function buildJobDefinitions(deps: JobRegistryDeps = {}): RegisteredJob[] {
  const emailSender = deps.emailSender ?? createEmailSenderFromEnv();
  const definitions: Array<JobDefinition<never>> = [
    aiVisibilityRunJob as unknown as JobDefinition<never>,
    crawlJob as unknown as JobDefinition<never>,
    agentRunJob as unknown as JobDefinition<never>,
    createFreeSnapshotJob(emailSender) as unknown as JobDefinition<never>,
    remeasurementJob as unknown as JobDefinition<never>,
  ];
  return definitions.map((definition) => toRegisteredJob(definition));
}

export class JobHandlerCoverageError extends Error {
  constructor(
    readonly missing: readonly string[],
    readonly duplicated: readonly string[],
    readonly undeclared: readonly string[],
  ) {
    super(
      [
        'Job handler coverage check failed.',
        missing.length > 0
          ? `No handler registered for declared job type(s): ${missing.join(', ')}. ` +
            'Add a JobDefinition to lib/queue/job-registry.ts — a job type with no ' +
            'handler is enqueued by the API and consumed by nobody.'
          : '',
        duplicated.length > 0 ? `More than one handler for job type(s): ${duplicated.join(', ')}.` : '',
        undeclared.length > 0
          ? `Handler registered for job type(s) missing from lib/queue/job-types.ts: ${undeclared.join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    this.name = 'JobHandlerCoverageError';
  }
}

/**
 * Throws unless the given definitions cover every declared job type exactly
 * once, and declare nothing that is not in `job-types.ts`. This is the loud
 * guard: called from `registerAllJobHandlers()` BEFORE the queue starts, so a
 * missing consumer is a boot failure rather than a class of job that silently
 * accumulates unclaimed rows in Postgres.
 */
export function assertJobHandlerCoverage(definitions: readonly RegisteredJob[]): void {
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    counts.set(definition.jobType, (counts.get(definition.jobType) ?? 0) + 1);
  }

  const missing = ALL_JOB_TYPES.filter((jobType) => !counts.has(jobType));
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([jobType]) => jobType);
  const undeclared = [...counts.keys()].filter((jobType) => !(ALL_JOB_TYPES as readonly string[]).includes(jobType));

  if (missing.length > 0 || duplicated.length > 0 || undeclared.length > 0) {
    throw new JobHandlerCoverageError(missing, duplicated, undeclared);
  }
}

export interface RegisterAllJobHandlersResult {
  definitions: RegisteredJob[];
  tracker: InFlightJobTracker;
}

/**
 * Registers every job handler on `queue`, wrapped in in-flight tracking so
 * graceful shutdown can release whatever is still running.
 *
 * Call this BEFORE `queue.start()`: `PgBossJobQueue` buffers registrations
 * made before start and creates each pg-boss queue on connect.
 */
export function registerAllJobHandlers(
  queue: JobQueue,
  deps: JobRegistryDeps & { tracker?: InFlightJobTracker } = {},
): RegisterAllJobHandlersResult {
  const definitions = buildJobDefinitions(deps);
  assertJobHandlerCoverage(definitions);

  const tracker = deps.tracker ?? new InFlightJobTracker();
  const instrumented = definitions.map((definition) => tracker.instrument(definition));
  for (const definition of instrumented) {
    queue.register<unknown>(definition.jobType, definition.handler);
  }

  return { definitions: instrumented, tracker };
}
