/**
 * Process-lifetime singleton — same precedent `lib/queue/default-job-queue.ts`
 * establishes for `JobQueue`. `app.ts`'s `onError` handler imports
 * `getDefaultErrorTracker()` — never a concrete class — so swapping the
 * implementation is a one-line change here, not a call-site change.
 */
import type { ErrorTracker } from './error-tracker.js';
import { ConsoleErrorTracker } from './console-error-tracker.js';

let instance: ErrorTracker | undefined;

/**
 * Defaults to `ConsoleErrorTracker` — the exact pre-Epic-19 behavior, so
 * this build's observable output is unchanged by this epic's refactor.
 * Swap to real Sentry tracking by constructing
 * `new SentryErrorTracker(process.env.SENTRY_DSN!)` here instead and
 * calling `.init()` once at server boot (`server.ts`) — a config change,
 * not a code change, per this epic's own definition of done.
 */
export function getDefaultErrorTracker(): ErrorTracker {
  if (!instance) instance = new ConsoleErrorTracker();
  return instance;
}

/** Test-only seam. */
export function __setDefaultErrorTrackerForTesting(tracker: ErrorTracker | undefined): void {
  instance = tracker;
}
