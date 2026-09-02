import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const findUniqueMock = vi.fn();

vi.mock('@bebest/database', () => ({
  db: {},
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ users: { findUnique: findUniqueMock } }),
  ),
}));

describe('requireAuth', () => {
  // Every other test file in this suite that mutates a shared `process.env`
  // key captures its ORIGINAL value once and restores it in `afterEach`
  // (see crm-access.test.ts, internal-org.test.ts, leads/deals/activities/
  // accounts.test.ts) so a value set for one test can never leak into the
  // next — regardless of whether the test that set it passed or threw.
  // This file used to be the one exception: the "never activates in
  // production" test below set `NODE_ENV = 'production'` and reset it back
  // to 'test' with a plain statement at the end of the test body. That
  // reset only ever runs if every assertion above it in the same test
  // passes — a single regression in that test would leave `NODE_ENV`
  // stuck at 'production' for every test that runs after it (in this file,
  // and in any other file that happens to share this file's worker
  // process/thread — see DECISIONS.md's "Test isolation" entry). Restoring
  // unconditionally in `afterEach`, like every other file already does,
  // removes that dependency on the test body succeeding.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_ALLOW_DEV_AUTH_BYPASS = process.env.ALLOW_DEV_AUTH_BYPASS;

  beforeEach(async () => {
    vi.resetModules();
    findUniqueMock.mockReset();
    delete process.env.ALLOW_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = 'test';

    const { __setKeysForTesting } = await import('../lib/jwt.js');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    __setKeysForTesting(privateKey, publicKey);
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;

    if (ORIGINAL_ALLOW_DEV_AUTH_BYPASS === undefined) delete process.env.ALLOW_DEV_AUTH_BYPASS;
    else process.env.ALLOW_DEV_AUTH_BYPASS = ORIGINAL_ALLOW_DEV_AUTH_BYPASS;
  });

  afterAll(async () => {
    const { __setKeysForTesting } = await import('../lib/jwt.js');
    __setKeysForTesting(null, null);
  });

  async function buildApp() {
    const { requireAuth } = await import('./auth.js');
    const app = new Hono();
    app.get('/protected', requireAuth, (c) => c.json(c.get('user')));
    return app;
  }

  it('rejects a request with no Authorization header', async () => {
    const app = await buildApp();
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed bearer token', async () => {
    const app = await buildApp();
    const res = await app.request('/protected', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token for a user that still exists and is not deleted', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const { signAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({ sub: 'user-1', email: 'a@example.com', org: 'org-1' });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      tokenOrgId: 'org-1',
    });
  });

  it('rejects a valid token for a soft-deleted user', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: new Date(),
    });

    const { signAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({ sub: 'user-1', email: 'a@example.com', org: null });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('rejects a valid token for a user that no longer exists', async () => {
    findUniqueMock.mockResolvedValue(null);

    const { signAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({ sub: 'ghost', email: 'a@example.com', org: null });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('the dev X-User-Id bypass does NOT activate without ALLOW_DEV_AUTH_BYPASS=true', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { 'x-user-id': 'user-1' } });
    expect(res.status).toBe(401); // falls through to real bearer-token check, which is absent
  });

  it('the dev X-User-Id bypass activates when explicitly opted in', async () => {
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { 'x-user-id': 'user-1' } });
    expect(res.status).toBe(200);
  });

  it('the dev bypass never activates in production even if the flag is set', async () => {
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const app = await buildApp();
    const res = await app.request('/protected', { headers: { 'x-user-id': 'user-1' } });
    expect(res.status).toBe(401);
  });
});
