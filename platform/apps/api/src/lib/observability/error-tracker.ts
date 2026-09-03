/**
 * Epic 19 (Production Hardening), item 3 — real error-tracking wired into
 * `app.ts`'s existing global `onError` handler, replacing the bare
 * `console.error(JSON.stringify(...))` call that was the only "tracking"
 * this codebase had before this epic.
 *
 * Two implementations exist, same `NullXProvider` discipline as every
 * other external integration in this codebase (`lib/email.ts`'s
 * `ConsoleEmailSender`, `lib/billing/payment-provider.ts`'s
 * `NullPaymentProvider`):
 * - `ConsoleErrorTracker` — current behavior (structured-JSON to stdout),
 *   stays the default (see `default-error-tracker.ts`).
 * - `SentryErrorTracker` — a real, complete implementation on top of the
 *   `@sentry/node` package (added as a dependency in this epic). Correct
 *   code, but never constructed with a real DSN anywhere in this build —
 *   `Sentry.init()` only runs if `.init()` is explicitly called, which
 *   nothing in this codebase does.
 *
 * `ErrorContext` is deliberately a narrow, explicit allowlist of
 * IDENTIFIERS (request id, method, path, org id, user id) — never the raw
 * `Context`/request object, headers, or cookies. This is the same "no
 * leaked internals" principle this build's other public-facing error
 * responses already follow (see `routes/snapshot.ts`'s generic failure
 * copy, `docs/epics/17-free-snapshot-frontend.md`'s explicit "no internal
 * error detail leaked to an unauthenticated visitor" note): an
 * `Authorization` header or magic-link/refresh token must never reach
 * either implementation, by construction, because the type callers pass
 * doesn't have a field to carry one.
 */

export interface ErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  organizationId?: string;
  userId?: string;
}

export interface ErrorTracker {
  /** Records an unhandled error. Must never throw — a tracking failure is
   * never allowed to become a second error masking the first. */
  captureException(err: unknown, context?: ErrorContext): void;
}
