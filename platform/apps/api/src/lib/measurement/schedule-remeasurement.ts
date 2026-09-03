/**
 * Epic 14 (Measurement & Learning Loop) — the 4-week re-measurement
 * trigger. Spec, verbatim: "Triggered automatically 4 weeks after an
 * actions row's executed_at (a scheduled check — reuse whatever job
 * mechanism exists, setImmediate-based placeholder acceptable with the
 * same honest `// TODO: durable queue` marker every prior epic used)."
 *
 * TODO: durable queue (pg-boss) — still accurate as of Epic 19 (Production
 * Hardening). That epic introduced `lib/queue/job-queue.ts` and migrated
 * every OTHER background job (`lib/ai-visibility/schedule-run.ts`,
 * `routes/crawl.ts`, `lib/agents/runner.ts`, `routes/snapshot.ts`) onto it,
 * but deliberately left THIS scheduler's `deps.schedule` closure-based
 * design (`(fn: () => void, delayMs: number) => unknown`) as-is rather than
 * force-fitting it onto `JobQueue.enqueue(jobType, payload, {delayMs})`:
 * `JobQueue` jobs are a `(jobType, serializable payload)` pair precisely so
 * they can survive a process restart once a durable backend
 * (`PgBossJobQueue`) is actually wired in — a raw closure can't be
 * serialized, so routing it through `enqueue()` unchanged would make the
 * eventual durable swap no more durable than today for this one caller,
 * while still risking its own 8 already-passing tests (exact timing
 * behavior around the 32-bit `setTimeout` ceiling) for no real gain. The
 * honest fix is to give this trigger its own `jobType` with a
 * `{ actionId, organizationId }` payload and a registered handler calling
 * `runMeasurementForAction`, then enqueue with `{ delayMs }` — real,
 * valuable follow-up work, explicitly tracked in this epic's backend
 * completion doc rather than done as a last-minute API break here. A
 * process restart still loses every pending re-measurement timer, exactly
 * as this comment said before Epic 19.
 *
 * Unlike every prior epic's `setImmediate` (fire essentially now, in the
 * background, after an HTTP response already went out), THIS trigger has a
 * real 4-week delay baked into its own spec — so the delay itself, not just
 * the "run in the background" part, needs to be injectable for tests (this
 * epic's own explicit instruction: "inject a controllable clock/trigger for
 * testing... do not require waiting real wall-clock time in tests"). Same
 * "injectable clock/delay, defaults to the real thing" precedent `lib/
 * crawler/engine.ts`'s own `CrawlEngineDeps.sleep` already establishes for
 * exactly this reason.
 */
import { runMeasurementForAction } from './run-measurement.js';

export const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

export interface ScheduleRemeasurementDeps {
  /** Injected for testing — call `fn` however (and whenever) the test
   * wants, e.g. synchronously to fire the trigger immediately with no real
   * wait at all. Defaults to real `setTimeout`, `.unref()`d so a pending
   * 4-week timer never itself keeps a process alive. */
  schedule?: (fn: () => void, delayMs: number) => unknown;
  /** Defaults to `FOUR_WEEKS_MS` — overridable so a test can also exercise
   * a short-but-real delay path without literally waiting 4 weeks. */
  delayMs?: number;
}

// `setTimeout`'s delay is a 32-bit signed int internally (Node AND every
// browser) — a delay past this is not an error, it SILENTLY CLAMPS to
// ~1ms (Node's own documented behavior: "If the timeout is greater than
// 2147483647... it will be treated as 1"). `FOUR_WEEKS_MS` (2,419,200,000)
// exceeds it, so a naive single `setTimeout(fn, FOUR_WEEKS_MS)` would fire
// almost immediately instead of 4 weeks later — caught by this epic's own
// test suite the moment a real (non-injected) delay was exercised (Node
// logs `TimeoutOverflowWarning` and clamps to 1ms, exactly the way it did
// during this epic's own build). `defaultSchedule` chains safe-sized
// `setTimeout` calls (each `.unref()`d, never keeping a process alive)
// until the full requested delay has actually elapsed — the standard fix
// for this exact, well-known Node/browser ceiling.
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

function defaultSchedule(fn: () => void, delayMs: number): void {
  scheduleChunked(fn, delayMs);
}

/**
 * Schedules exactly one re-measurement run for `actionId`. Never throws
 * synchronously — every EXPECTED failure inside `runMeasurementForAction`
 * (no before-score yet, no active query set, no crawl data, an entitlement
 * limit) is already handled there without throwing (see that module's own
 * doc comment); a genuinely UNEXPECTED failure (e.g. the database write
 * itself failing) is caught here as the backstop and logged, same "the
 * scheduler catches what the pipeline itself doesn't" split `schedule-
 * run.ts` already establishes for the GEO pipeline's own background job.
 */
export function scheduleRemeasurement(actionId: string, organizationId: string, deps: ScheduleRemeasurementDeps = {}): void {
  const schedule = deps.schedule ?? defaultSchedule;
  const delayMs = deps.delayMs ?? FOUR_WEEKS_MS;

  schedule(() => {
    void runMeasurementForAction(organizationId, actionId).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'remeasurement_failed',
          actionId,
          organizationId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }, delayMs);
}
