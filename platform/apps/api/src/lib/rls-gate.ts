/**
 * The Row-Level Security startup gate, in a form a serverless function can
 * use.
 *
 * `server.ts` and `worker.ts` both `await assertRlsEnforced()` once before
 * they begin serving, which is the whole point of that check: in production a
 * role that bypasses RLS is a reason not to start, because the failure is
 * otherwise invisible (see packages/database/src/rls-check.ts).
 *
 * The deployed architecture has no such boot. Every customer-facing route runs
 * through `api/index.js` on Vercel, which requires `dist/app.cjs` and serves
 * immediately — so the one gate standing between a mis-granted database role
 * and every tenant reading every other tenant's rows was not on the path that
 * ships. Only the worker host would have noticed, and only whenever it next
 * booted.
 *
 * A per-request check is not an option (two queries on every request), so the
 * gate is memoized per instance: the first request of a cold start pays for
 * it, every later request on that instance awaits an already-settled promise.
 *
 * Failures are NOT memoized. Fail-closed is right for a security gate, but a
 * cached rejection would also brick an instance for its entire lifetime over a
 * single unreachable-database blip at cold start — `checkRlsEnforcement` issues
 * real queries and a connection failure propagates. So a failed attempt is
 * discarded and the next request retries, while the request that observed the
 * failure is still refused.
 */
import { assertRlsEnforced } from '@bebest/database';

let inFlight: Promise<void> | null = null;

async function check(): Promise<void> {
  // Same escape hatch server.ts honours, for a deliberately database-less boot.
  if (process.env.SKIP_RLS_CHECK === 'true') return;
  await assertRlsEnforced();
}

/**
 * Resolves once this instance has confirmed tenant isolation is in force.
 * Rejects if it is not — or if the question could not be answered at all.
 *
 * Callers must treat a rejection as "do not serve this request". The rejection
 * message names the connected role and a source file, so it belongs in logs,
 * never in a response body.
 */
export function ensureRlsEnforced(): Promise<void> {
  inFlight ??= check().catch((err: unknown) => {
    inFlight = null; // let the next cold-start request try again
    throw err;
  });
  return inFlight;
}

/** Test-only: forget the memoized result. */
export function resetRlsGateForTests(): void {
  inFlight = null;
}
