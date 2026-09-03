/**
 * Real error-tracking implementation on top of `@sentry/node` (D-O14
 * "Error tracking" is still formally OPEN in the root `DECISIONS.md`'s
 * Open Decisions table — this class makes Sentry concretely implementable
 * per this epic's own spec, which names it as the intended choice; it does
 * not itself close D-O14, which needs a real sign-off with a real Sentry
 * account/DSN this build environment doesn't have).
 *
 * Correct, complete code — but per this build's hard constraint (no real
 * network call to an external provider), it is never constructed by
 * `default-error-tracker.ts`. `Sentry.init()` — the only call in this
 * class that would open a real network connection — only runs inside
 * `.init()`, which nothing in this codebase calls; simply importing or
 * constructing this class (as its unit test does, with `@sentry/node`
 * mocked) makes no network call either.
 *
 * Swapping this in for real: change `default-error-tracker.ts`'s
 * `getDefaultErrorTracker()` to construct
 * `new SentryErrorTracker(process.env.SENTRY_DSN!)` and call `.init()`
 * once at server boot (`server.ts`) — a config change, not a code change,
 * per this epic's own definition of done.
 */
import * as Sentry from '@sentry/node';
import type { ErrorContext, ErrorTracker } from './error-tracker.js';

export class SentryErrorTracker implements ErrorTracker {
  private initialized = false;

  constructor(private readonly dsn: string) {}

  /** Opens the real connection to Sentry. Separate from the constructor so
   * a `SentryErrorTracker` can be constructed (e.g. in a test, or to sanity-
   * check config) without ever dialing out — same "construct now, connect
   * later, only if asked" split `PgBossJobQueue`'s `start()` uses. */
  init(): void {
    Sentry.init({
      dsn: this.dsn,
      // This build's own `NODE_ENV` convention (see `middleware/auth.ts`'s
      // dev-bypass check) — never send events from a local/dev run to a
      // real Sentry project by accident if this were ever constructed
      // outside `NODE_ENV=production`.
      environment: process.env.NODE_ENV ?? 'development',
      // Never attach request bodies/headers — see this file's header
      // comment and `error-tracker.ts`'s `ErrorContext` doc comment on why
      // only an explicit identifier allowlist is ever passed to
      // `captureException` below in the first place; this is defense in
      // depth against Sentry's own default request-data capture picking up
      // an `Authorization` header from ambient Node request instrumentation.
      sendDefaultPii: false,
    });
    this.initialized = true;
  }

  captureException(err: unknown, context: ErrorContext = {}): void {
    if (!this.initialized) {
      // Never throws — same "a tracking failure never becomes a second
      // error" contract every `ErrorTracker` implementation must honor
      // (see `error-tracker.ts`'s interface doc comment). An uninitialized
      // tracker capturing nothing is a config bug, not a request-time
      // failure worth crashing (or double-logging) over.
      return;
    }

    Sentry.withScope((scope) => {
      // Explicit allowlist, one field at a time — never `scope.setContext('request', context)`
      // with the whole object, so adding a field to `ErrorContext` later
      // can't silently start forwarding something sensitive without a
      // matching line added here too.
      if (context.requestId) scope.setTag('request_id', context.requestId);
      if (context.method) scope.setTag('http.method', context.method);
      if (context.path) scope.setTag('http.path', context.path);
      if (context.organizationId) scope.setTag('organization_id', context.organizationId);
      if (context.userId) scope.setUser({ id: context.userId });
      Sentry.captureException(err);
    });
  }
}
