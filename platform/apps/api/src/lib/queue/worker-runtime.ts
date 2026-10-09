/**
 * The worker process's lifecycle, separated from the `src/worker.ts`
 * entrypoint so it can be tested without spawning a process or installing
 * real signal handlers.
 *
 * Start: register every handler (`job-registry.ts` — which refuses to proceed
 * if any declared job type has no handler), then connect and begin consuming.
 *
 * Shutdown (SIGTERM on every deploy; SIGINT in dev):
 * 1. Stop fetching new jobs and give in-flight handlers a bounded grace
 *    period to finish — `PgBossJobQueue.stop()` is graceful, but a baseline
 *    run takes hours, so waiting for it is not an option and the host would
 *    SIGKILL us anyway.
 * 2. Release whatever is still running, via each job's own
 *    `releaseOnShutdown`, so no `ai_runs`/`crawl_jobs`/`agent_runs` row is
 *    left in `running` with nothing alive that could ever finish it. pg-boss
 *    itself will retry the job (the row stays claimable once its lock
 *    expires); marking the domain row `failed` is about not lying to the user
 *    in the meantime.
 * 3. Exit.
 */
import type { JobQueue } from './job-queue.js';
import { getDefaultJobQueue } from './default-job-queue.js';
import { InFlightJobTracker } from './in-flight-jobs.js';
import { registerAllJobHandlers, type JobRegistryDeps } from './job-registry.js';

export type WorkerLogger = (entry: Record<string, unknown>) => void;

const defaultLogger: WorkerLogger = (entry) => {
  console.error(JSON.stringify(entry));
};

export interface WorkerRuntimeOptions extends JobRegistryDeps {
  queue?: JobQueue;
  /** How long in-flight handlers get to finish after we stop accepting work.
   * Keep it comfortably under the host's own SIGTERM→SIGKILL window (Railway
   * and Fly default to ~30s, Render to 30s). */
  shutdownGraceMs?: number;
  log?: WorkerLogger;
  tracker?: InFlightJobTracker;
}

export const DEFAULT_SHUTDOWN_GRACE_MS = 20_000;

export class WorkerRuntime {
  private readonly queue: JobQueue;
  private readonly log: WorkerLogger;
  private readonly shutdownGraceMs: number;
  private readonly registryDeps: JobRegistryDeps;
  private tracker: InFlightJobTracker;
  private started = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: WorkerRuntimeOptions = {}) {
    this.queue = options.queue ?? getDefaultJobQueue();
    this.log = options.log ?? defaultLogger;
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.registryDeps = { emailSender: options.emailSender };
    this.tracker = options.tracker ?? new InFlightJobTracker();
  }

  get inFlightCount(): number {
    return this.tracker.size;
  }

  get isShuttingDown(): boolean {
    return this.shutdownPromise !== undefined;
  }

  /** Registers every handler, then starts consuming. Throws (without
   * starting the queue) if any declared job type has no handler. */
  async start(): Promise<void> {
    if (this.started) return;
    const { definitions, tracker } = registerAllJobHandlers(this.queue, {
      ...this.registryDeps,
      tracker: this.tracker,
    });
    this.tracker = tracker;
    await this.queue.start();
    this.started = true;
    this.log({
      level: 'info',
      msg: 'worker_started',
      jobTypes: definitions.map((definition) => definition.jobType),
      shutdownGraceMs: this.shutdownGraceMs,
    });
  }

  /** Idempotent — a second SIGTERM while shutting down joins the first. */
  async shutdown(reason: string): Promise<void> {
    this.shutdownPromise ??= this.runShutdown(reason);
    await this.shutdownPromise;
  }

  private async runShutdown(reason: string): Promise<void> {
    this.log({
      level: 'info',
      msg: 'worker_shutdown_started',
      reason,
      inFlight: this.tracker.size,
      inFlightJobTypes: this.tracker.inFlightJobTypes(),
      graceMs: this.shutdownGraceMs,
    });

    let graceExpired = false;
    try {
      graceExpired = await this.stopQueueWithinGracePeriod();
    } catch (err) {
      this.log({
        level: 'error',
        msg: 'worker_queue_stop_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Anything still running never got to finish. Release it rather than
    // leaving a row in `running` that nothing alive will ever complete.
    if (this.tracker.size > 0) {
      const summary = await this.tracker.releaseAll();
      this.log({ level: 'error', msg: 'worker_released_in_flight_jobs', graceExpired, ...summary });
    }

    this.started = false;
    this.log({ level: 'info', msg: 'worker_shutdown_complete', reason });
  }

  /** Resolves true if the grace period expired before the queue stopped. */
  private async stopQueueWithinGracePeriod(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.shutdownGraceMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([this.queue.stop().then(() => false), expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createWorkerRuntime(options: WorkerRuntimeOptions = {}): WorkerRuntime {
  return new WorkerRuntime(options);
}

export interface SignalHandlerOptions {
  /** Defaults to `process.on`-style registration on the real process. */
  on?: (signal: NodeJS.Signals, listener: () => void) => void;
  exit?: (code: number) => void;
  log?: WorkerLogger;
  signals?: readonly NodeJS.Signals[];
}

/**
 * Wires SIGTERM/SIGINT to a bounded, logged shutdown followed by an explicit
 * exit. The explicit exit matters: pg-boss keeps a Postgres pool open, so a
 * worker that merely stops consuming would linger until the host SIGKILLs it.
 */
export function installSignalHandlers(runtime: WorkerRuntime, options: SignalHandlerOptions = {}): void {
  const on = options.on ?? ((signal, listener) => void process.on(signal, listener));
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? defaultLogger;
  const signals = options.signals ?? (['SIGTERM', 'SIGINT'] as const);

  for (const signal of signals) {
    on(signal, () => {
      void runtime
        .shutdown(signal)
        .then(() => exit(0))
        .catch((err: unknown) => {
          log({
            level: 'error',
            msg: 'worker_shutdown_failed',
            signal,
            error: err instanceof Error ? err.message : String(err),
          });
          exit(1);
        });
    });
  }
}
