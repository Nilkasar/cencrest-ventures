/**
 * Real durable-queue implementation on top of `pg-boss`.
 *
 * As of the HTTP/worker split this is the production queue on BOTH sides of
 * the deployment (see `platform/GO_LIVE.md` §5):
 * - the Vercel HTTP process constructs it (via
 *   `default-job-queue.ts`/`createJobQueueFromEnv`) and only ever calls
 *   `enqueue()` — it registers nothing, so it never subscribes to a queue
 *   and never claims a job it could not finish;
 * - the worker process (`src/worker.ts`) constructs it, registers every
 *   handler in `job-registry.ts`, and calls `start()` — that is the only
 *   process that ever runs a handler.
 *
 * Two behaviors exist specifically because the enqueue side is serverless:
 *
 * 1. `enqueue()` lazily connects. pg-boss only opens a pool inside
 *    `.start()`, and `.send()` on a queue that does not exist yet fails — so
 *    a cold Vercel invocation whose only job is to enqueue would otherwise
 *    have to know to call `.start()` first (and `.start()` on a process with
 *    no registrations subscribes to nothing, so it is safe to do).
 * 2. `ensureQueues` (the declared job types, `job-types.ts`) are created on
 *    connect regardless of what this process registers, so the very first
 *    enqueue can happen before the worker has ever booted.
 */
import { PgBoss } from 'pg-boss';
import type { EnqueueOptions, JobHandler, JobQueue } from './job-queue.js';

export interface PgBossJobQueueOptions {
  /** Job types whose pg-boss queue must exist before anything is sent to
   * it — normally `ALL_JOB_TYPES`. Also acts as the declared-type allowlist:
   * an `enqueue()` of a type outside this set is logged loudly (a job with
   * no declared consumer is a bug, not something to swallow) and its queue
   * created anyway, so the job is recorded rather than lost. */
  ensureQueues?: readonly string[];
  /** Seconds pg-boss waits for in-flight handlers during a graceful
   * `stop()`. The worker's own shutdown path bounds this too — see
   * `worker-runtime.ts`. */
  gracefulStopSeconds?: number;
}

function logQueueEvent(msg: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: 'error', msg, ...fields }));
}

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly ensureQueues: readonly string[];
  private readonly gracefulStopSeconds: number;
  private started = false;
  private startPromise: Promise<void> | undefined;
  private readonly createdQueues = new Set<string>();
  /** pg-boss requires a queue to exist (`createQueue`) before `.work()` can
   * subscribe to it or `.send()` can enqueue onto it. Registrations made
   * before `.start()` are buffered here and flushed once `.start()` has
   * created every queue — this lets call sites `register()` at module-load
   * time (the same "register once, at import time" shape
   * `InMemoryJobQueue` callers already use) regardless of whether
   * `.start()` has run yet. */
  private pendingRegistrations: Array<{ jobType: string; handler: JobHandler<unknown> }> = [];

  constructor(connectionString: string, options?: PgBossJobQueueOptions) {
    this.boss = new PgBoss({ connectionString });
    this.ensureQueues = options?.ensureQueues ?? [];
    this.gracefulStopSeconds = options?.gracefulStopSeconds ?? 30;
  }

  register<TPayload>(jobType: string, handler: JobHandler<TPayload>): void {
    if (!this.started) {
      this.pendingRegistrations.push({ jobType, handler: handler as JobHandler<unknown> });
      return;
    }
    this.subscribe(jobType, handler);
  }

  private subscribe<TPayload>(jobType: string, handler: JobHandler<TPayload>): void {
    // `.work()` returns a subscription id; fire-and-forget it the same way
    // every prior epic's background job fired-and-forgot its
    // `setImmediate` callback — a rejected promise here is a pg-boss/
    // connection failure, not a per-job failure (those are caught inside
    // the loop below and never propagate out of the handler pg-boss
    // invokes).
    void this.boss.work<TPayload>(jobType, async (jobs) => {
      for (const job of jobs) {
        try {
          await handler(job.data as TPayload);
        } catch (err) {
          logQueueEvent('pgboss_job_queue_handler_failed', {
            jobType,
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Re-thrown so pg-boss records the job as `failed` (and retries
          // per its own retry-policy config) instead of silently marking
          // it `completed` — domain-specific "mark the crawl_jobs/ai_runs/
          // agent_runs row failed" handling still lives inside `handler`
          // itself, same as every InMemoryJobQueue-routed call site today.
          throw err;
        }
      }
    });
  }

  /** `createQueue` is idempotent from this class's point of view: already
   * created in this process is tracked, and a concurrent creation by another
   * process (the worker and an HTTP function racing on a cold start) is
   * swallowed — the queue existing is the only thing we need. */
  private async ensureQueue(jobType: string): Promise<void> {
    if (this.createdQueues.has(jobType)) return;
    try {
      await this.boss.createQueue(jobType);
    } catch (err) {
      logQueueEvent('pgboss_job_queue_create_queue_failed', {
        jobType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.createdQueues.add(jobType);
  }

  async enqueue<TPayload>(jobType: string, payload: TPayload, options?: EnqueueOptions): Promise<void> {
    if (this.ensureQueues.length > 0 && !this.ensureQueues.includes(jobType)) {
      // Loud, not silent: an undeclared job type has no entry in
      // `job-types.ts`, which means `registerAllJobHandlers()` never
      // asserted a handler for it and no worker is subscribed. The job is
      // still persisted (so it can be redriven once a handler exists)
      // rather than dropped on the floor.
      logQueueEvent('pgboss_job_queue_undeclared_job_type', {
        jobType,
        declared: this.ensureQueues,
      });
    }
    await this.ensureStarted();
    await this.ensureQueue(jobType);
    await this.boss.send(
      jobType,
      payload as object,
      options?.delayMs ? { startAfter: new Date(Date.now() + options.delayMs) } : undefined,
    );
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    this.startPromise ??= this.startOnce();
    await this.startPromise;
  }

  async start(): Promise<void> {
    await this.ensureStarted();
  }

  private async startOnce(): Promise<void> {
    await this.boss.start();
    for (const jobType of this.ensureQueues) await this.ensureQueue(jobType);
    for (const { jobType } of this.pendingRegistrations) await this.ensureQueue(jobType);
    this.started = true;
    for (const { jobType, handler } of this.pendingRegistrations) {
      this.subscribe(jobType, handler);
    }
    this.pendingRegistrations = [];
  }

  /** Graceful by default: pg-boss stops fetching new jobs and waits up to
   * `gracefulStopSeconds` for handlers that are already running. Anything
   * still in flight past that is the worker's problem to release — see
   * `worker-runtime.ts`'s shutdown path. */
  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: this.gracefulStopSeconds * 1000 });
    this.started = false;
    this.startPromise = undefined;
    this.createdQueues.clear();
  }
}
