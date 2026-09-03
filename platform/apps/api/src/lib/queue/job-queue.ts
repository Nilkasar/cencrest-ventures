/**
 * Epic 19 (Production Hardening), item 1 — the durable job queue interface.
 *
 * Every prior epic's background job (Epic 3's crawler, Epic 7/8's AI
 * visibility pipeline, Epic 12's agent runner, Epic 17's free-snapshot
 * pipeline) scheduled its fire-and-forget work with a raw `setImmediate`
 * call at the route/lib call site, each carrying its own honest
 * `// TODO: durable queue (pg-boss)` comment. This interface is that TODO
 * resolved: every one of those call sites now goes through
 * `getDefaultJobQueue()` (see `default-job-queue.ts`) instead of calling
 * `setImmediate` directly.
 *
 * Two implementations exist:
 * - `InMemoryJobQueue` — functionally equivalent to the `setImmediate`
 *   behavior every call site had before this epic. Remains the default
 *   (see `default-job-queue.ts`), so nothing changes behaviorally without
 *   a real Postgres connection being wired in.
 * - `PgBossJobQueue` — a real, complete implementation on top of the
 *   `pg-boss` package (added as a dependency in this epic). Correct code,
 *   but never constructed or `.start()`-ed anywhere in this build — same
 *   `NullXProvider` discipline every prior epic's external integration
 *   (email, payments) uses. Swapping to it is a config change: construct
 *   `new PgBossJobQueue(connectionString)` instead of `new
 *   InMemoryJobQueue()` in `default-job-queue.ts`, call `.start()` once at
 *   server boot, and register every handler the same way — no call-site
 *   changes, because every call site already goes through the `JobQueue`
 *   interface, never a concrete class.
 *
 * A process restart losing whatever `InMemoryJobQueue` had in flight is an
 * honestly-documented gap — the same one every one of the four call sites'
 * own `// TODO` comments already named, now centralized in one place
 * instead of four.
 */

/** A job's handler. Must never throw past its own internal error handling
 * for InMemoryJobQueue callers that want a specific on-failure side effect
 * (e.g. marking a `crawl_jobs`/`ai_runs`/`agent_runs` row `failed`) — the
 * queue's own wrapper `catch` (see each implementation) is a backstop log,
 * not a substitute for that domain-specific handling. */
export type JobHandler<TPayload> = (payload: TPayload) => Promise<void>;

export interface EnqueueOptions {
  /** Delays execution by this many milliseconds instead of firing as soon
   * as possible. Used by Epic 14's 4-week re-measurement trigger (see that
   * module's own header comment on why it is NOT migrated onto this
   * interface in this epic despite the delay support existing here). */
  delayMs?: number;
}

export interface JobQueue {
  /**
   * Registers the handler that processes jobs of `jobType`. Idempotent —
   * calling it again for the same `jobType` replaces the handler (this is
   * what happens harmlessly every time a module that registers one is
   * re-imported, e.g. across test files sharing the process-lifetime
   * default queue).
   *
   * Must be called before any `enqueue()` of that `jobType`. `enqueue()` is
   * itself an `async` function, so `InMemoryJobQueue` does NOT throw
   * synchronously into the (already fire-and-forget) callback if it
   * isn't — a `throw` inside an `async` function body always becomes a
   * REJECTED PROMISE, not a synchronous throw, which would be an unhandled
   * rejection at every real call site (none of them `.catch()` the bare
   * `void enqueue(...)` they use). Instead, `InMemoryJobQueue.enqueue()`
   * catches the missing-handler case internally and logs it the same way
   * any other handler failure is, rather than silently dropping the job or
   * rejecting past its own fire-and-forget boundary.
   */
  register<TPayload>(jobType: string, handler: JobHandler<TPayload>): void;

  /**
   * Enqueues one job. Resolves once the job is durably recorded —
   * `InMemoryJobQueue` resolves immediately (there is nothing to persist);
   * `PgBossJobQueue` resolves once `pg-boss` has written the row.
   * Execution itself is always asynchronous relative to this call, even
   * with no `delayMs` — callers must never assume the handler has run by
   * the time `enqueue()` resolves.
   */
  enqueue<TPayload>(jobType: string, payload: TPayload, options?: EnqueueOptions): Promise<void>;

  /** Starts processing registered jobs. No-op for `InMemoryJobQueue` (there
   * is no connection to open — registered handlers already fire on
   * `enqueue()`). Connects to Postgres and begins polling for
   * `PgBossJobQueue`. */
  start(): Promise<void>;

  /** Stops processing. No-op for `InMemoryJobQueue`. Disconnects for
   * `PgBossJobQueue`. */
  stop(): Promise<void>;
}
