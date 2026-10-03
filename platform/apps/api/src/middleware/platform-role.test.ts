import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';
import type { AppEnv } from '../types/context.js';

const db = {
  users: { findUnique: vi.fn() },
  platform_access_events: { createMany: vi.fn() },
};

vi.mock('@bebest/database', () => ({ db }));

const captureException = vi.fn();
vi.mock('../lib/observability/default-error-tracker.js', () => ({
  getDefaultErrorTracker: () => ({ captureException }),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_USER_ID = '33333333-3333-4333-8333-333333333333';

const AUTH_USER = { id: USER_ID, email: 'staff@bebestwithai.com', name: 'Staff', deleted_at: null };

/** Real `requireAuth` in front, exactly as the routes wire it, so the token
 *  path is the real one — the token carries no platform role at all. */
async function buildApp() {
  const { requireAuth } = await import('./auth.js');
  const { requirePlatformRole } = await import('./platform-role.js');
  const app = new Hono<AppEnv>();
  const platform = new Hono<AppEnv>();
  platform.get('/support-thing', requireAuth, requirePlatformRole('support'), (c) =>
    c.json({ ok: true, role: c.get('platformRole') }),
  );
  platform.post('/admin-thing', requireAuth, requirePlatformRole('admin'), (c) => c.json({ ok: true }));
  platform.get('/orgs/:id', requireAuth, requirePlatformRole('support', { targetOrgParam: 'id' }), (c) =>
    c.json({ ok: true }),
  );
  platform.get('/orgs/:orgId/users/:userId', requireAuth, requirePlatformRole('support'), (c) =>
    c.json({ ok: true }),
  );
  app.route('/api/platform', platform);
  return app;
}

async function bearer() {
  const { signAccessToken } = await import('../lib/jwt.js');
  return `Bearer ${await signAccessToken({ sub: USER_ID, email: AUTH_USER.email, org: null })}`;
}

/** `requireAuth` reads the full user; the guard reads `platform_role` with
 *  a `select`. One mock serves both, the role coming from `role`. */
function databaseRole(role: string | null, extra: Partial<typeof AUTH_USER> = {}) {
  db.users.findUnique.mockImplementation(async (args: { select?: unknown }) =>
    args.select ? { platform_role: role, deleted_at: extra.deleted_at ?? null } : { ...AUTH_USER, ...extra },
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  db.platform_access_events.createMany.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
});

afterAll(async () => {
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  __setKeysForTesting(null, null);
});

describe('requirePlatformRole', () => {
  it('401s without authentication and never reaches the guard', async () => {
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing');
    expect(res.status).toBe(401);
    expect(db.platform_access_events.createMany).not.toHaveBeenCalled();
  });

  it("403s a user whose platform_role is 'none' and writes no access event", async () => {
    databaseRole('none');
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Platform access required' });
    expect(db.platform_access_events.createMany).not.toHaveBeenCalled();
  });

  it('treats an unknown platform_role value as none (fails closed)', async () => {
    databaseRole('superadmin');
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(403);
  });

  it('403s a soft-deleted staff user even if their row still says admin', async () => {
    db.users.findUnique.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { platform_role: 'admin', deleted_at: new Date() } : AUTH_USER,
    );
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(403);
  });

  it('lets support through a support route and records exactly one access event', async () => {
    databaseRole('support');
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'support' });
    expect(db.platform_access_events.createMany).toHaveBeenCalledTimes(1);
    expect(db.platform_access_events.createMany).toHaveBeenCalledWith({
      data: [
        {
          user_id: USER_ID,
          platform_role: 'support',
          action: 'GET /api/platform/support-thing',
          target_org_id: null,
          target_user_id: null,
          request_path: '/api/platform/support-thing',
          method: 'GET',
        },
      ],
    });
  });

  it('lets admin through a support route (admin outranks support)', async () => {
    databaseRole('admin');
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'admin' });
  });

  it('403s support on an admin route and writes nothing', async () => {
    databaseRole('support');
    const app = await buildApp();
    const res = await app.request('/api/platform/admin-thing', {
      method: 'POST',
      headers: { authorization: await bearer() },
    });
    expect(res.status).toBe(403);
    expect(db.platform_access_events.createMany).not.toHaveBeenCalled();
  });

  it('lets admin through an admin route', async () => {
    databaseRole('admin');
    const app = await buildApp();
    const res = await app.request('/api/platform/admin-thing', {
      method: 'POST',
      headers: { authorization: await bearer() },
    });
    expect(res.status).toBe(200);
    expect(db.platform_access_events.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      platform_role: 'admin',
      action: 'POST /api/platform/admin-thing',
      method: 'POST',
    });
  });

  it('re-reads the role from the database on every request — the same token loses access the moment the grant is revoked', async () => {
    const app = await buildApp();
    const authorization = await bearer();

    databaseRole('support');
    expect((await app.request('/api/platform/support-thing', { headers: { authorization } })).status).toBe(200);

    databaseRole('none');
    expect((await app.request('/api/platform/support-thing', { headers: { authorization } })).status).toBe(403);

    const guardReads = db.users.findUnique.mock.calls.filter(([args]) => (args as { select?: unknown }).select);
    expect(guardReads).toHaveLength(2);
    expect(guardReads[0]?.[0]).toEqual({
      where: { id: USER_ID },
      select: { platform_role: true, deleted_at: true },
    });
  });

  it('fails the request with 500 when the access event cannot be written — the handler never runs', async () => {
    databaseRole('admin');
    db.platform_access_events.createMany.mockRejectedValue(new Error('connection reset'));
    const app = await buildApp();
    const res = await app.request('/api/platform/support-thing', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Platform access could not be audited' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('records the target org from a named route param', async () => {
    databaseRole('support');
    const app = await buildApp();
    await app.request(`/api/platform/orgs/${ORG_ID}`, { headers: { authorization: await bearer() } });
    expect(db.platform_access_events.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      action: 'GET /api/platform/orgs/:id',
      target_org_id: ORG_ID,
      target_user_id: null,
      request_path: `/api/platform/orgs/${ORG_ID}`,
    });
  });

  it('records orgId/userId params by default', async () => {
    databaseRole('support');
    const app = await buildApp();
    await app.request(`/api/platform/orgs/${ORG_ID}/users/${TARGET_USER_ID}`, {
      headers: { authorization: await bearer() },
    });
    expect(db.platform_access_events.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      target_org_id: ORG_ID,
      target_user_id: TARGET_USER_ID,
    });
  });

  it('does not record a non-UUID param as a target, but still audits the path', async () => {
    databaseRole('support');
    const app = await buildApp();
    const res = await app.request('/api/platform/orgs/not-a-uuid', { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(db.platform_access_events.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      target_org_id: null,
      request_path: '/api/platform/orgs/not-a-uuid',
    });
  });

  it('retries without targets when the target id names no row (FK violation), so "no such org" is not a 500', async () => {
    databaseRole('support');
    db.platform_access_events.createMany
      .mockRejectedValueOnce(Object.assign(new Error('fk'), { code: 'P2003' }))
      .mockResolvedValueOnce({ count: 1 });
    const app = await buildApp();
    const res = await app.request(`/api/platform/orgs/${ORG_ID}`, { headers: { authorization: await bearer() } });
    expect(res.status).toBe(200);
    expect(db.platform_access_events.createMany).toHaveBeenCalledTimes(2);
    expect(db.platform_access_events.createMany.mock.calls[1]?.[0].data[0]).toMatchObject({
      target_org_id: null,
      request_path: `/api/platform/orgs/${ORG_ID}`,
    });
  });
});
