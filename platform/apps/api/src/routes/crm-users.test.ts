import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn(), findMany: vi.fn() },
  users: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: crmUsers } = await import('./crm-users.js');
  const app = new Hono();
  app.route('/crm/users', crmUsers);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const ORIGINAL_INTERNAL_ORG_ID = process.env.CRM_INTERNAL_ORG_ID;

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'A' });
  db.organizations.findUnique.mockResolvedValue({ id: INTERNAL_ORG_ID, name: 'Ops', slug: 'ops' });
  db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
});

afterEach(() => {
  process.env.CRM_INTERNAL_ORG_ID = ORIGINAL_INTERNAL_ORG_ID;
});

describe('GET /crm/users', () => {
  it('returns the internal org roster, name-sorted, in one call', async () => {
    db.memberships.findMany.mockResolvedValue([
      { user_id: 'u-2', role: 'admin' },
      { user_id: 'u-1', role: 'owner' },
    ]);
    db.users.findMany.mockResolvedValue([
      { id: 'u-1', name: 'Zoe Ray', email: 'zoe@bebestwithai.com' },
      { id: 'u-2', name: 'Ava Chen', email: 'ava@bebestwithai.com' },
    ]);

    const app = await buildApp();
    const res = await app.request('/crm/users', {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string; role: string }[] };
    expect(body.data.map((u) => u.name)).toEqual(['Ava Chen', 'Zoe Ray']);
    expect(body.data[0]).toMatchObject({ id: 'u-2', role: 'admin' });
  });

  it('skips a membership whose user record is gone rather than inventing one', async () => {
    db.memberships.findMany.mockResolvedValue([
      { user_id: 'u-1', role: 'owner' },
      { user_id: 'ghost', role: 'member' },
    ]);
    db.users.findMany.mockResolvedValue([
      { id: 'u-1', name: 'Zoe Ray', email: 'zoe@bebestwithai.com' },
    ]);

    const app = await buildApp();
    const res = await app.request('/crm/users', {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('403s when the caller is acting as an org other than the internal one', async () => {
    db.organizations.findUnique.mockResolvedValue({ id: OTHER_ORG_ID, name: 'Client', slug: 'client' });

    const app = await buildApp();
    const res = await app.request('/crm/users', {
      headers: await authHeader('user-1', OTHER_ORG_ID),
    });

    expect(res.status).toBe(403);
  });

  it('401s without a token', async () => {
    const app = await buildApp();
    const res = await app.request('/crm/users');
    expect(res.status).toBe(401);
  });
});
