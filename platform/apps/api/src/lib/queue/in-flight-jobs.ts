/**
 * Tracks which job payloads are running RIGHT NOW in this process, so that a
 * worker being shut down can do something honest about the ones it cannot
 * finish.
 *
 * Why this is not optional: an AI Visibility baseline run is hours of wall
 * time. Any real host (Railway/Render/Fly/a container) will SIGTERM the
 * worker on every deploy, and it will land mid-run far more often than not.
 * Without this, the `ai_runs` row stays `running` forever and the user's
 * dashboard shows a run that is never going to finish or fail — precisely the
 * bug `lib/ai-visibility/schedule-run.ts`'s header comment has always
 * admitted to, just moved from "process restart" to "deploy".
 *
 * The tracker does NOT try to resume work. It moves the domain row out of the
 * in-progress state via the job's own `releaseOnShutdown`, using the same
 * "mark it failed, best effort" write each handler's error path already does,
 * so the run is visibly failed and retryable.
 */
import type { JobHandler } from './job-queue.js';
import type { RegisteredJob } from './registered-job.js';

export interface ReleaseSummary {
  /** In-flight jobs at the moment `releaseAll()` was called. */
  inFlight: number;
  /** Ones whose `releaseOnShutdown` ran without throwing. */
  released: number;
  /** Ones with no `releaseOnShutdown`, or whose release threw. */
  unreleased: number;
}

export class InFlightJobTracker {
  private nextId = 0;
  private readonly running = new Map<number, { job: RegisteredJob; payload: unknown }>();

  /** Returns the same job with its handler wrapped in tracking. Register the
   * returned job with the queue, not the original. */
  instrument(job: RegisteredJob): RegisteredJob {
    const handler: JobHandler<unknown> = async (payload) => {
      const id = this.nextId++;
      this.running.set(id, { job, payload });
      try {
        await job.handler(payload);
      } finally {
        this.running.delete(id);
      }
    };
    return { ...job, handler };
  }

  get size(): number {
    return this.running.size;
  }

  /** Job types currently in flight — for shutdown logging. */
  inFlightJobTypes(): string[] {
    return [...this.running.values()].map((entry) => entry.job.jobType);
  }

  /**
   * Releases every still-running job. Never throws: a release that fails is
   * counted, logged by the caller, and the shutdown continues — a worker that
   * refuses to exit because a cleanup write failed just gets SIGKILLed a
   * moment later, which is strictly worse.
   */
  async releaseAll(): Promise<ReleaseSummary> {
    const entries = [...this.running.values()];
    let released = 0;
    let unreleased = 0;

    await Promise.all(
      entries.map(async ({ job, payload }) => {
        if (!job.releaseOnShutdown) {
          unreleased += 1;
          return;
        }
        try {
          await job.releaseOnShutdown(payload);
          released += 1;
        } catch {
          unreleased += 1;
        }
      }),
    );

    return { inFlight: entries.length, released, unreleased };
  }
}
