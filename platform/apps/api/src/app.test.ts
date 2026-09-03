import { describe, expect, it, afterEach, vi } from 'vitest';
import type { ErrorContext, ErrorTracker } from './lib/observability/error-tracker.js';
import { __setDefaultErrorTrackerForTesting } from './lib/observability/default-error-tracker.js';
import type App from './app.js';

// The onError suite below routes a real request through the FULL app
// (`app.ts`'s global middleware stack, `publicRateLimit` included), which
// calls `checkRateLimit` (`lib/rate-limiter.ts`) — normally backed by real
// Postgres (`organization_rate_limits`, @bebest/database). No DB connection
// is available in this test environment, so this mocks only that narrow
// function (never the whole `@bebest/database` package, which several
// route modules `app.ts` transitively imports rely on more of) to always
// allow, matching this suite's existing rate-limiter unit tests'
// (`lib/rate-limiter.test.ts`) own mocking of the DB layer one level lower.
// Harmless for the CORS suite above: an OPTIONS preflight is answered by
// the `cors` middleware itself, before `publicRateLimit` ever runs.
vi.mock('./lib/rate-limiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 29,
    limit: 30,
    resetAt: Math.floor(Date.now() / 1000) + 60,
  }),
}));

// Regression test for docs/epics/20-marketing-site-rebuild.md's "Non-
// negotiable: fix the CORS domain mismatch" — the production allowlist
// previously named `bebestwith.ai`, a different domain from the one the
// marketing site is actually deployed and canonicalized under
// (`bebestwithai.com`). Exercised via an OPTIONS preflight (Hono's `cors`
// middleware answers preflights itself, before any route handler or DB
// access runs), against the REAL production CORS config — never dev's
// permissive `*` — per the spec's explicit instruction.
//
// `app.ts` reads `process.env.NODE_ENV` at module-evaluation time (not
// per-request), so NODE_ENV must be set to 'production' BEFORE the dynamic
// import below.

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

async function buildProdApp() {
  process.env.NODE_ENV = 'production';
  const { default: app } = await import('./app.js');
  return app;
}

describe('CORS — production allowlist', () => {
  // Epic 19 (Production Hardening) — explicit 30s timeout. `buildProdApp()`
  // dynamically imports the ENTIRE `app.js` (every route module this whole
  // codebase has, transitively), which observably costs anywhere from
  // ~3.5s to 10s+ depending on machine/CI load at the moment — not a
  // correctness regression (the assertion itself is deterministic; only
  // the import cost varies), just a slow-import cost that collided with
  // vitest's 5s default under load. 30s gives real headroom over the
  // worst observed case rather than chasing a moving target.
  it('allows a preflight from the real deployed marketing-site origin (bebestwithai.com)', async () => {
    const app = await buildProdApp();
    const res = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://bebestwithai.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://bebestwithai.com');
  }, 30000);

  it('allows a preflight from the www subdomain and the app subdomain', async () => {
    const app = await buildProdApp();

    const www = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://www.bebestwithai.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(www.headers.get('Access-Control-Allow-Origin')).toBe('https://www.bebestwithai.com');

    const appSub = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.bebestwithai.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(appSub.headers.get('Access-Control-Allow-Origin')).toBe('https://app.bebestwithai.com');
  }, 30000);

  it('does NOT allow the old, wrong domain (bebestwith.ai) any more — locks in the fix', async () => {
    const app = await buildProdApp();
    const res = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://bebestwith.ai', 'Access-Control-Request-Method': 'POST' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://bebestwith.ai');
  }, 30000);
});

// Epic 19 (Production Hardening), item 3 follow-up (qa-flow-tester
// "needs-fixes") — `app.ts`'s global `app.onError` handler was verified
// correct by direct code reading (see its own header comment above the
// handler) but nothing actually drove a real thrown error through the LIVE
// app and asserted both halves of its contract: (a) the client only ever
// sees the generic `{error: 'Internal server error'}` / 500 — never the
// real error's message or stack — and (b) the configured `ErrorTracker`
// gets the real error plus only the narrow `ErrorContext` allowlist
// (requestId/method/path/organizationId/userId), never headers, cookies,
// or the request body. `console-error-tracker.test.ts` /
// `sentry-error-tracker.test.ts` / `default-error-tracker.test.ts` only
// test the tracker classes in isolation — never this wiring.
//
// This test needs to add its OWN throwaway route to the live app so it has
// something that reliably throws. `app.js`'s shared module instance
// (`buildProdApp()` above) has already had real requests routed through it
// by the CORS tests by the time this describe block runs — and Hono's
// `SmartRouter` permanently locks its matcher after the first request,
// throwing "Can not add a route since the matcher is already built." on any
// route added afterward. So this test imports its own separate instance of
// `app.js` via a distinct (query-suffixed) specifier — Vite/Vitest's module
// graph keys an import by its exact specifier string, so `./app.js` and
// `./app.js?onerror-test` are two independently-evaluated module instances,
// each with its own never-yet-requested (never-yet-locked) Hono app — while
// still exercising the real, unmodified `app.ts` source, onError handler
// included.
async function importFreshAppInstance(): Promise<typeof App> {
  process.env.NODE_ENV = 'production';
  const specifier = './app.js' + '?onerror-test'; // deliberately non-literal — see comment above
  const mod = (await import(/* @vite-ignore */ specifier)) as { default: typeof App };
  return mod.default;
}

describe('onError — global error handler', () => {
  afterEach(() => {
    __setDefaultErrorTrackerForTesting(undefined); // restore the real ConsoleErrorTracker default
  });

  it('returns exactly {error: "Internal server error"} / 500 (never the real error message/stack) and forwards only the narrow allowlisted context to the error tracker', async () => {
    const app = await importFreshAppInstance();

    const captured: Array<{ err: unknown; context: ErrorContext | undefined }> = [];
    const fakeTracker: ErrorTracker = {
      captureException(err, context) {
        captured.push({ err, context });
      },
    };
    __setDefaultErrorTrackerForTesting(fakeTracker);

    // A real thrown error through the live app — not a mock, not a
    // simulated Response. This route exists only for this test.
    const SECRET_MESSAGE = 'internal detail: db password is hunter2 — must never reach the client';
    app.get('/api/__test-onerror-throw', () => {
      throw new Error(SECRET_MESSAGE);
    });

    const res = await app.request('/api/__test-onerror-throw', {
      headers: {
        'X-Request-Id': 'test-onerror-request-id',
        Authorization: 'Bearer should-never-be-forwarded-to-the-tracker',
        Cookie: 'session=should-never-be-forwarded-either',
      },
    });

    // (a) the client-facing half of the contract.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Internal server error' });
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toContain(SECRET_MESSAGE);
    expect(rawBody).not.toContain('hunter2');
    expect(rawBody.toLowerCase()).not.toContain('stack');

    // (b) the error-tracker half of the contract.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.err).toBeInstanceOf(Error);
    expect((captured[0]!.err as Error).message).toBe(SECRET_MESSAGE);

    const context = captured[0]!.context;
    expect(context?.requestId).toBe('test-onerror-request-id');
    expect(context?.method).toBe('GET');
    expect(context?.path).toBe('/api/__test-onerror-throw');
    // No auth/org context on this unauthenticated ad hoc route — asserted
    // explicitly rather than left implicit.
    expect(context?.organizationId).toBeUndefined();
    expect(context?.userId).toBeUndefined();

    // The allowlist is exhaustive — no headers, cookies, or body ever leak
    // into the context object passed to the tracker.
    expect(Object.keys(context ?? {}).sort()).toEqual(['method', 'organizationId', 'path', 'requestId', 'userId'].sort());
    expect(context).not.toHaveProperty('headers');
    expect(context).not.toHaveProperty('authorization');
    expect(context).not.toHaveProperty('cookie');
    expect(context).not.toHaveProperty('body');
  }, 30000);
});
