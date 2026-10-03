import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  users: { findUnique: vi.fn() },
  platform_access_events: { createMany: vi.fn() },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

vi.mock('@bebest/database', () => ({ db }));

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@bebestwithai.com',
  name: 'Staff Member',
  deleted_at: null,
};

function databaseRole(role: string) {
  db.users.findUnique.mockImplementation(async (args: { select?: unknown }) =>
    args.select ? { platform_role: role, deleted_at: null } : USER,
  );
}

async function buildApp() {
  const { default: session } = await import('./session.js');
  const app = new Hono();
  app.route('/api/platform/session', session);
  return app;
}

async function bearer() {
  const { signAccessToken } = await import('../../lib/jwt.js');
  return `Bearer ${await signAccessToken({ sub: USER.id, email: USER.email, org: null })}`;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  db.platform_access_events.createMany.mockResolvedValue({ count: 1 });
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
});

afterAll(async () => {
  const { __setKeysForTesting } = await import('../../lib/jwt.js');
  __setKeysForTesting(null, null);
});

describe('GET /api/platform/session', () => {
  it('401s without a token', async () => {
    const app = await buildApp();
    expect((await app.request('/api/platform/session')).status).toBe(401);
  });

  it("403s a customer (platform_role 'none') and writes no access event", async () => {
    databaseRole('none');
    const app = await buildApp();
    const res = await app.request('/api/platform/session', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(403);
    expect(db.platform_access_events.createMany).not.toHaveBeenCalled();
  });

  it('returns the platform role and the user for support staff, and audits the call', async () => {
    databaseRole('support');
    const app = await buildApp();
    const res = await app.request('/api/platform/session', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platformRole: 'support',
      user: { id: USER.id, email: USER.email, name: USER.name },
    });
    expect(db.platform_access_events.createMany).toHaveBeenCalledTimes(1);
    expect(db.platform_access_events.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      user_id: USER.id,
      platform_role: 'support',
      action: 'GET /api/platform/session',
      request_path: '/api/platform/session',
      method: 'GET',
    });
  });

  it('returns admin for an admin', async () => {
    databaseRole('admin');
    const app = await buildApp();
    const res = await app.request('/api/platform/session', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { platformRole: string }).platformRole).toBe('admin');
  });

  it('is rate limited per user (authenticatedRateLimit runs before the guard)', async () => {
    databaseRole('support');
    db.organization_rate_limits.upsert.mockResolvedValue({ count: 121 });
    const app = await buildApp();
    const res = await app.request('/api/platform/session', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(429);
    expect(db.platform_access_events.createMany).not.toHaveBeenCalled();
  });
});
