import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
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
  beforeEach(async () => {
    vi.resetModules();
    findUniqueMock.mockReset();
    delete process.env.ALLOW_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = 'test';

    const { __setKeysForTesting } = await import('../lib/jwt.js');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    __setKeysForTesting(privateKey, publicKey);
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
    process.env.NODE_ENV = 'test';
  });
});
