/**
 * The pre-Epic-19 behavior, preserved exactly and extracted into an
 * `ErrorTracker` implementation: one structured-JSON line to stderr per
 * error, same shape `app.ts`'s `onError` handler wrote inline before this
 * epic (`level`, `requestId`, `msg`, `stack`) plus the request's
 * `method`/`path` when the caller has them (additive — no existing field
 * removed or renamed). This is the default `ErrorTracker` (see
 * `default-error-tracker.ts`), so this build's observable behavior is
 * unchanged by introducing the interface.
 */
import type { ErrorContext, ErrorTracker } from './error-tracker.js';

export class ConsoleErrorTracker implements ErrorTracker {
  captureException(err: unknown, context: ErrorContext = {}): void {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        organizationId: context.organizationId,
        userId: context.userId,
        msg: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
  }
}
