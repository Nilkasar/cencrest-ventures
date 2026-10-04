import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

// Response bodies in these tests are asserted structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

const db = {
  organizations: { findUnique: vi.fn(), update: vi.fn() },
  memberships: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  agency_clients: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  notification_preferences: { findMany: vi.fn(), upsert: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};
const tx = db;

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_u: string, fn: (t: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_o: string, fn: (t: unknown) => unknown) => fn(tx)),
}));

const resolvePlanLimits = vi.fn();
vi.mock('../lib/entitlements.js', () => ({ resolvePlanLimits }));

const ORG = { id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null, autonomy_level_max: 3 }; // the column default (migration 0025)

async function buildApp() {
  const { default: orgSettings } = await import('./org-settings.js');
  const app = new Hono();
  app.route('/orgs/me', orgSettings);
  return app;
}

async function auth(userId = 'user-1', org: string | null = 'org-1') {
  const { signAccessToken } = await import('../lib/jwt.js');
  return { authorization: `Bearer ${await signAccessToken({ sub: userId, email: 'a@example.com', org })}` };
}

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const app = await buildApp();
  return app.request(path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(headers ?? (await auth())) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  db.memberships.findMany.mockResolvedValue([]);
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue(ORG);
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.notification_preferences.findMany.mockResolvedValue([]);
  resolvePlanLimits.mockResolvedValue({ plan: 'pro', limits: { autonomy_level_max: 3, agents: true } });
});

describe('GET /orgs/me/notification-preferences', () => {
  it('401 without a token, 409 with no org selected', async () => {
    expect((await req('GET', '/orgs/me/notification-preferences', undefined, {})).status).toBe(401);
    expect((await req('GET', '/orgs/me/notification-preferences', undefined, await auth('user-1', null))).status).toBe(409);
  });

  it('defaults (no rows) = every emitted type on for both channels', async () => {
    const res = await req('GET', '/orgs/me/notification-preferences');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.preferences.map((p: { eventType: string }) => p.eventType)).toEqual([
      'run_complete',
      'report_ready',
      'weekly_digest',
      'competitor_alert',
      'invitation_accepted',
    ]);
    for (const p of body.preferences) expect(p).toMatchObject({ inApp: true, email: true });
    expect(body.preferences.find((p: { eventType: string }) => p.eventType === 'competitor_alert').emailApplicable).toBe(false);
  });

  it("reflects stored rows, scoped to the caller's own user id in this org", async () => {
    db.notification_preferences.findMany.mockResolvedValue([
      { notification_type: 'report_ready', channel: 'email', enabled: false },
    ]);
    const body = await json(await req('GET', '/orgs/me/notification-preferences'));
    expect(body.preferences.find((p: { eventType: string }) => p.eventType === 'report_ready')).toMatchObject({
      inApp: true,
      email: false,
    });
    expect(db.notification_preferences.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: 'org-1', user_id: 'user-1' } }),
    );
  });
});

describe('PUT /orgs/me/notification-preferences', () => {
  it('any member (viewer) may set their own; one upsert per channel given; audited', async () => {
    db.notification_preferences.upsert.mockResolvedValue({});
    const res = await req('PUT', '/orgs/me/notification-preferences', {
      preferences: [
        { eventType: 'report_ready', email: false },
        { eventType: 'run_complete', inApp: false, email: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(db.notification_preferences.upsert).toHaveBeenCalledTimes(3);
    expect(db.notification_preferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_user_type_channel: {
            organization_id: 'org-1',
            user_id: 'user-1',
            notification_type: 'report_ready',
            channel: 'email',
          },
        },
        update: { enabled: false },
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'settings.changed', entity_type: 'notification_preferences' }) }),
    );
  });

  it('422s unknown types, duplicates, empty entries and an empty list', async () => {
    for (const body of [
      { preferences: [{ eventType: 'billing_alert', email: false }] },
      { preferences: [{ eventType: 'report_ready', email: false }, { eventType: 'report_ready', inApp: false }] },
      { preferences: [{ eventType: 'report_ready' }] },
      { preferences: [] },
      { preferences: [{ eventType: 'report_ready', email: 'no' }] },
      null,
    ]) {
      expect((await req('PUT', '/orgs/me/notification-preferences', body)).status).toBe(422);
    }
    expect(db.notification_preferences.upsert).not.toHaveBeenCalled();
  });

  it('ignores any user id in the body — always the caller', async () => {
    db.notification_preferences.upsert.mockResolvedValue({});
    await req('PUT', '/orgs/me/notification-preferences', {
      userId: 'someone-else',
      preferences: [{ eventType: 'report_ready', email: false, userId: 'someone-else' }],
    });
    expect(db.notification_preferences.upsert.mock.calls[0]![0].create.user_id).toBe('user-1');
  });
});

describe('GET /orgs/me/autonomy', () => {
  it('returns the org level, the plan cap and what is selectable', async () => {
    db.organizations.findUnique.mockResolvedValue({ ...ORG, autonomy_level_max: 2 });
    resolvePlanLimits.mockResolvedValue({ plan: 'growth', limits: { autonomy_level_max: null, agents: true } });
    const body = await json(await req('GET', '/orgs/me/autonomy'));
    expect(body).toEqual({
      level: 2,
      effectiveMax: 2,
      planMax: null,
      maxAllowed: 3,
      plan: 'growth',
      agentsAvailable: true,
      canEdit: false,
    });
  });

  it('default org level 3 under a plan capped at 2 → effectiveMax is the plan cap (min of the two)', async () => {
    resolvePlanLimits.mockResolvedValue({ plan: 'starter', limits: { autonomy_level_max: 2, agents: true } });
    const body = await json(await req('GET', '/orgs/me/autonomy'));
    expect(body).toMatchObject({ level: 3, maxAllowed: 2, effectiveMax: 2 });
  });
});

describe('PUT /orgs/me/autonomy', () => {
  it('403 for a member below admin', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
    expect((await req('PUT', '/orgs/me/autonomy', { level: 2 })).status).toBe(403);
    expect(db.organizations.update).not.toHaveBeenCalled();
  });

  it('an admin sets it within the plan cap; audited old → new', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    db.organizations.update.mockResolvedValue({});
    const res = await req('PUT', '/orgs/me/autonomy', { level: 1 });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ level: 1, effectiveMax: 1 });
    expect(db.organizations.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: expect.objectContaining({ autonomy_level_max: 1 }),
    });
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'settings.changed',
          old_value: { autonomyLevelMax: 3 },
          new_value: { autonomyLevelMax: 1 },
        }),
      }),
    );
  });

  it('422 above the plan cap', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    resolvePlanLimits.mockResolvedValue({ plan: 'starter', limits: { autonomy_level_max: 2, agents: true } });
    const res = await req('PUT', '/orgs/me/autonomy', { level: 3 });
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ code: 'exceeds_plan', maxAllowed: 2 });
    expect(db.organizations.update).not.toHaveBeenCalled();
  });

  it('level 4 and every other non-1/2/3 value is rejected, even for the owner on an uncapped plan', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    resolvePlanLimits.mockResolvedValue({ plan: 'enterprise', limits: { autonomy_level_max: null, agents: true } });
    for (const level of [4, 5, 0, -1, 2.5, '3', null]) {
      const res = await req('PUT', '/orgs/me/autonomy', { level });
      expect(res.status).toBe(422);
    }
    expect((await req('PUT', '/orgs/me/autonomy', {})).status).toBe(422);
    expect(db.organizations.update).not.toHaveBeenCalled();
  });

  it('setting the same level is a no-op (no write, no audit)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const res = await req('PUT', '/orgs/me/autonomy', { level: 3 });
    expect(res.status).toBe(200);
    expect(db.organizations.update).not.toHaveBeenCalled();
    expect(db.audit_events.create).not.toHaveBeenCalled();
  });
});
