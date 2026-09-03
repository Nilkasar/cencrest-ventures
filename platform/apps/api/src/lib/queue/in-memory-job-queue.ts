/**
 * Functionally equivalent to the `setImmediate` placeholder every prior
 * epic's background job used before this epic — see `job-queue.ts`'s
 * header comment. This is the default `JobQueue` (see
 * `default-job-queue.ts`), so nothing about a request's observable
 * behavior changes by introducing the `JobQueue` interface itself; only
 * swapping in `PgBossJobQueue` with a real connection string changes
 * anything.
 *
 * No persistence, no cross-process visibility, no retry — a process
 * restart between `enqueue()` and the handler firing loses the job, same
 * as the `setImmediate` it replaces. That is the honestly-documented gap
 * this epic centralizes rather than solves (solving it is what
 * `PgBossJobQueue` is for).
 */
import type { EnqueueOptions, JobHandler, JobQueue } from './job-queue.js';

// Same 32-bit signed-int `setTimeout` ceiling fix
// `lib/measurement/schedule-remeasurement.ts` already documented and
// solved for its own real-delay case — reimplemented here so any caller of
// this queue (not just that one file) gets a correct long delay instead of
// Node's documented "greater than 2147483647 clamps to 1ms" behavior.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function unref(handle: unknown): void {
  (handle as { unref?: () => void }).unref?.();
}

function scheduleChunked(fn: () => void, remainingMs: number): void {
  const chunk = Math.min(Math.max(remainingMs, 0), MAX_TIMEOUT_MS);
  const handle = setTimeout(() => {
    const left = remainingMs - chunk;
    if (left > 0) scheduleChunked(fn, left);
    else fn();
  }, chunk);
  unref(handle);
}

function logHandlerFailure(jobType: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'in_memory_job_queue_handler_failed',
      jobType,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

export class InMemoryJobQueue implements JobQueue {
  private handlers = new Map<string, JobHandler<unknown>>();

  register<TPayload>(jobType: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(jobType, handler as JobHandler<unknown>);
  }

  async enqueue<TPayload>(jobType: string, payload: TPayload, options?: EnqueueOptions): Promise<void> {
    const handler = this.handlers.get(jobType);
    if (!handler) {
      // `enqueue()` is an `async` function, so a `throw` here would NOT be a
      // synchronous throw to the caller — JS turns a throw inside an async
      // function body into a REJECTED PROMISE. None of the 4 real call
      // sites (`routes/crawl.ts`, `lib/ai-visibility/schedule-run.ts`,
      // `lib/agents/runner.ts`, `routes/snapshot.ts`) `.catch()` the bare
      // `void enqueue(...)` they call this with, so a rejection here would
      // become an unhandled promise rejection rather than staying inside
      // this "fire-and-forget" boundary. Every real call site currently
      // registers its handler at module load before any route can fire, so
      // this path is inert today — but catching it here and logging it the
      // same way `fire()`'s own handler-failure catch below does (see
      // `logHandlerFailure`) makes that safe by construction instead of
      // merely safe-by-current-invariant.
      logHandlerFailure(
        jobType,
        new Error(`InMemoryJobQueue: no handler registered for job type "${jobType}". Call register() before enqueue().`),
      );
      return;
    }

    // Fire-and-forget, same as the `setImmediate` this replaces — enqueue()
    // itself resolves immediately (there is nothing to durably persist),
    // matching the interface's documented "resolves once the job is
    // durably recorded" contract for the in-memory case (nothing is ever
    // durable here).
    const fire = () => {
      void handler(payload).catch((err) => logHandlerFailure(jobType, err));
    };

    if (options?.delayMs && options.delayMs > 0) {
      scheduleChunked(fire, options.delayMs);
    } else {
      setImmediate(fire);
    }
  }

  // No connection exists to open or close — registered handlers already
  // fire directly from `enqueue()`.
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
