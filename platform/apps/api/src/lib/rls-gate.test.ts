import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const assertRlsEnforced = vi.fn();

vi.mock('@bebest/database', () => ({
  assertRlsEnforced: (...args: unknown[]) => assertRlsEnforced(...args),
}));

import { ensureRlsEnforced, resetRlsGateForTests } from './rls-gate.js';

describe('ensureRlsEnforced', () => {
  const previousSkip = process.env.SKIP_RLS_CHECK;

  beforeEach(() => {
    assertRlsEnforced.mockReset();
    resetRlsGateForTests();
    delete process.env.SKIP_RLS_CHECK;
  });

  afterEach(() => {
    if (previousSkip === undefined) delete process.env.SKIP_RLS_CHECK;
    else process.env.SKIP_RLS_CHECK = previousSkip;
  });

  it('checks the database once per instance, not once per request', async () => {
    assertRlsEnforced.mockResolvedValue({ role: 'bebest_app' });

    await Promise.all([ensureRlsEnforced(), ensureRlsEnforced()]);
    await ensureRlsEnforced();

    expect(assertRlsEnforced).toHaveBeenCalledTimes(1);
  });

  it('rejects the request that observes the failure — a request is never served on an unverified database', async () => {
    assertRlsEnforced.mockRejectedValue(new Error('Row-Level Security is NOT being enforced'));

    await expect(ensureRlsEnforced()).rejects.toThrow(/NOT being enforced/);
  });

  it('does NOT cache the failure, so one unreachable-database blip does not brick the instance', async () => {
    // The whole reason failures are not memoized: `checkRlsEnforcement` issues
    // real queries, so a cold-start connection blip surfaces here exactly like
    // a genuine RLS problem. Caching that rejection would 503 every later
    // request on this instance for its entire lifetime.
    assertRlsEnforced.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(ensureRlsEnforced()).rejects.toThrow(/ECONNREFUSED/);

    assertRlsEnforced.mockResolvedValue({ role: 'bebest_app' });
    await expect(ensureRlsEnforced()).resolves.toBeUndefined();
    expect(assertRlsEnforced).toHaveBeenCalledTimes(2);
  });

  it('honours SKIP_RLS_CHECK, the same escape hatch server.ts has', async () => {
    process.env.SKIP_RLS_CHECK = 'true';

    await expect(ensureRlsEnforced()).resolves.toBeUndefined();
    expect(assertRlsEnforced).not.toHaveBeenCalled();
  });
});

// ── The wiring, not just the unit ─────────────────────────────────────────
// A correct, tested gate that nothing calls is the exact failure this whole
// change fixes: `assertRlsEnforced` already existed, already had tests, and
// simply was not on the path that ships. So both ends of the wire are checked.
describe('the Vercel serverless entry actually awaits the gate', () => {
  const entry = readFileSync(path.resolve(import.meta.dirname, '../../api/index.js'), 'utf8');

  it('destructures ensureRlsEnforced from the bundle', () => {
    expect(entry).toMatch(/ensureRlsEnforced\s*\}?\s*=\s*require\(|ensureRlsEnforced\s*,|,\s*ensureRlsEnforced/);
  });

  it('awaits it inside the handler and refuses with 503 when it rejects', () => {
    expect(entry).toMatch(/await\s+ensureRlsEnforced\(\)/);
    expect(entry).toMatch(/statusCode\s*=\s*503/);
  });

  it('awaits the gate BEFORE delegating to the Hono listener', () => {
    const gate = entry.indexOf('await ensureRlsEnforced()');
    const serve = entry.indexOf('return honoListener(');
    expect(gate).toBeGreaterThan(-1);
    expect(serve).toBeGreaterThan(gate);
  });

  it('does not leak the failure detail into the response body', () => {
    // The rejection message names the connected database role and a repo path,
    // so the body must be a fixed string — never the caught error. Checked by
    // asserting the response body does not reference the caught binding, rather
    // than by pattern-matching words, since the static body legitimately
    // contains the KEY `error`.
    const body = /res\.end\(JSON\.stringify\(\{([^}]*)\}\)\)/.exec(entry)?.[1] ?? '';
    expect(body).not.toBe('');
    expect(body).not.toMatch(/\berr\b/);
    expect(body).not.toMatch(/\.message/);

    // And the detail does reach the logs, where it belongs — through
    // describeError, because the database layer throws non-Error values whose
    // message the plain `instanceof Error` idiom discards. See describe-error.ts.
    expect(entry).toMatch(/console\.error\([\s\S]*detail: describeError\(err\)/);
    expect(entry).toMatch(/describeError\s*\}?\s*=\s*require\(|,\s*describeError/);
  });

  it('app.ts exports it, so the destructure above is not undefined at runtime', async () => {
    const appSource = readFileSync(path.resolve(import.meta.dirname, '../app.ts'), 'utf8');
    expect(appSource).toMatch(/export\s*\{\s*ensureRlsEnforced\s*\}/);
  });
});
