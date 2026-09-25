/**
 * Process-lifetime singleton — same "one instance app-wide, selected from
 * the environment" precedent `lib/email.ts` (`ResendEmailSender` when
 * `RESEND_API_KEY` is set, `ConsoleEmailSender` otherwise),
 * `lib/billing/payment-provider.ts` (`createPaymentProviderFromEnv`) and
 * `lib/observability/default-error-tracker.ts` already establish. Every
 * background-job call site imports `getDefaultJobQueue()` — never
 * constructs `InMemoryJobQueue` or `PgBossJobQueue` itself.
 *
 * Selection rule (one variable, `JOB_QUEUE_DATABASE_URL`, per
 * `platform/GO_LIVE.md` §2):
 * - **set** → `PgBossJobQueue`. Jobs are durably persisted in Postgres and
 *   consumed by the separate worker process (`src/worker.ts`). The HTTP
 *   process enqueues and nothing else.
 * - **unset** → `InMemoryJobQueue`. Single-process dev and the whole test
 *   suite keep the pre-split behavior: the handler fires in the same
 *   process via `setImmediate`, with no Postgres involved.
 *
 * That one variable is also what tells the HTTP side NOT to register
 * handlers it can never usefully run — see `jobsRunInSeparateWorker()` and
 * `register-in-process.ts`.
 */
import type { JobQueue } from './job-queue.js';
import { InMemoryJobQueue } from './in-memory-job-queue.js';
import { PgBossJobQueue } from './pgboss-job-queue.js';
import { ALL_JOB_TYPES, JOB_POLICIES } from './job-types.js';

let instance: JobQueue | undefined;

function connectionString(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.JOB_QUEUE_DATABASE_URL?.trim();
  return raw ? raw : undefined;
}

/**
 * True when jobs are consumed by a DIFFERENT process than the one asking.
 *
 * The HTTP process (Vercel serverless, `api/index.js`) must not register job
 * handlers: it cannot run them — its execution context is frozen the moment
 * the response returns — and a registered handler on a durable queue means
 * `.work()`, i.e. actively claiming jobs the worker should have had. So
 * every registration site is gated on this being false.
 */
export function jobsRunInSeparateWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return connectionString(env) !== undefined;
}

/** Builds the queue the environment asks for, without touching the
 * singleton. Exported for the worker (which wants its own explicit
 * construction) and for tests. Constructing `PgBossJobQueue` opens no
 * connection — only `.start()`/`.enqueue()` do. */
export function createJobQueueFromEnv(env: NodeJS.ProcessEnv = process.env): JobQueue {
  const url = connectionString(env);
  if (!url) return new InMemoryJobQueue();
  // Every declared job type's pg-boss queue is created on connect, by the
  // enqueue side as well as the worker side: pg-boss refuses to `send()` to
  // a queue that does not exist yet, and on Vercel the HTTP process may well
  // enqueue the very first job before the worker has ever booted.
  // `jobPolicies` is not optional in practice: pg-boss's default
  // `expireInSeconds` is 15 minutes, and an AI Visibility baseline run takes
  // hours — see JOB_POLICIES' comment for what that default would do.
  return new PgBossJobQueue(url, { ensureQueues: ALL_JOB_TYPES, jobPolicies: JOB_POLICIES });
}

export function getDefaultJobQueue(): JobQueue {
  if (!instance) instance = createJobQueueFromEnv();
  return instance;
}

/** Test-only seam — lets a test inject a fresh queue (or a spy wrapping the
 * real one) instead of sharing the process-lifetime singleton with every
 * other test file. */
export function __setDefaultJobQueueForTesting(queue: JobQueue | undefined): void {
  instance = queue;
}
