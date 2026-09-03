/**
 * Real durable-queue implementation on top of `pg-boss` (D-O05 "Queue
 * system" is still formally OPEN in the root `DECISIONS.md`'s Open
 * Decisions table — this class makes pg-boss's interface concretely
 * implementable per this epic's own spec, which names it as the intended
 * choice; it does not itself close D-O05, which needs a real sign-off with
 * a durable Postgres connection this build environment doesn't have).
 *
 * Correct, complete code — but per this build's hard constraint (no real
 * network/DB connections), it is never constructed by
 * `default-job-queue.ts` and `.start()` is never called anywhere in this
 * codebase. `pg-boss` itself only opens a connection inside `.start()`, so
 * simply importing/constructing this class (as its unit test does, with a
 * mocked `pg-boss` module) makes no network call either.
 *
 * Swapping this in for real: change `default-job-queue.ts`'s
 * `getDefaultJobQueue()` to construct `new
 * PgBossJobQueue(process.env.JOB_QUEUE_DATABASE_URL!)`, call `.start()`
 * once at server boot (`server.ts`), and re-register the same handlers
 * every call site already registers today — no call-site changes, because
 * every call site already goes through the `JobQueue` interface.
 */
import { PgBoss } from 'pg-boss';
import type { EnqueueOptions, JobHandler, JobQueue } from './job-queue.js';

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private started = false;
  /** pg-boss requires a queue to exist (`createQueue`) before `.work()` can
   * subscribe to it or `.send()` can enqueue onto it. Registrations made
   * before `.start()` are buffered here and flushed once `.start()` has
   * created every queue — this lets call sites `register()` at module-load
   * time (the same "register once, at import time" shape
   * `InMemoryJobQueue` callers already use) regardless of whether
   * `.start()` has run yet. */
  private pendingRegistrations: Array<{ jobType: string; handler: JobHandler<unknown> }> = [];

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString });
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
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'pgboss_job_queue_handler_failed',
              jobType,
              jobId: job.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
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

  async enqueue<TPayload>(jobType: string, payload: TPayload, options?: EnqueueOptions): Promise<void> {
    await this.boss.send(jobType, payload as object, options?.delayMs ? { startAfter: new Date(Date.now() + options.delayMs) } : undefined);
  }

  async start(): Promise<void> {
    await this.boss.start();
    for (const { jobType } of this.pendingRegistrations) {
      await this.boss.createQueue(jobType);
    }
    for (const { jobType, handler } of this.pendingRegistrations) {
      this.subscribe(jobType, handler);
    }
    this.pendingRegistrations = [];
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.boss.stop();
    this.started = false;
  }
}
