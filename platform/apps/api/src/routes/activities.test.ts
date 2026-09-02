import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '55555555-5555-5555-5555-555555555555';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  leads: { findFirst: vi.fn() },
  deals: { findFirst: vi.fn() },
  activities: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  leads: db.leads,
  deals: db.deals,
  activities: db.activities,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: activities } = await import('./activities.js');
  const app = new Hono();
  app.route('/activities', activities);
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
  process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({
    id: INTERNAL_ORG_ID,
    slug: 'bebest-internal',
    name: 'BeBest Internal',
    deleted_at: null,
  });
  db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
});

afterEach(() => {
  if (ORIGINAL_INTERNAL_ORG_ID === undefined) delete process.env.CRM_INTERNAL_ORG_ID;
  else process.env.CRM_INTERNAL_ORG_ID = ORIGINAL_INTERNAL_ORG_ID;
});

describe('POST /activities', () => {
  it('403s for a viewer (below log_crm_activities)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ type: 'note', body: 'Called them', leadId: LEAD_ID }),
    });
    expect(res.status).toBe(403);
  });

  it('an editor CAN log an activity, even though they cannot manage deals', async () => {
    db.leads.findFirst.mockResolvedValue({ id: LEAD_ID });
    db.activities.create.mockResolvedValue({
      id: 'activity-1',
      lead_id: LEAD_ID,
      deal_id: null,
      account_organization_id: null,
      type: 'note',
      subject: null,
      body: 'Called them',
      metadata: {},
      actor_id: 'user-1',
      created_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ type: 'note', body: 'Called them', leadId: LEAD_ID }),
    });

    expect(res.status).toBe(201);
    expect(db.activities.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organization_id: INTERNAL_ORG_ID, lead_id: LEAD_ID, actor_id: 'user-1' }),
      }),
    );
  });

  it('422s when none of leadId/dealId/accountOrganizationId is given', async () => {
    const app = await buildApp();
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ type: 'note', body: 'Orphan note' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s when leadId does not refer to an existing lead', async () => {
    db.leads.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ type: 'note', body: 'x', leadId: LEAD_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /activities', () => {
  it('422s when no target filter is given', async () => {
    const app = await buildApp();
    const res = await app.request('/activities', { headers: await authHeader('user-1', INTERNAL_ORG_ID) });
    expect(res.status).toBe(422);
  });

  it('lists activities for a lead, newest first', async () => {
    db.activities.findMany.mockResolvedValue([
      {
        id: 'a-2',
        lead_id: LEAD_ID,
        deal_id: null,
        account_organization_id: null,
        type: 'call',
        subject: null,
        body: 'Follow-up call',
        metadata: {},
        actor_id: 'user-1',
        created_at: new Date('2026-01-02'),
      },
    ]);
    db.activities.count.mockResolvedValue(1);

    const app = await buildApp();
    const res = await app.request(`/activities?leadId=${LEAD_ID}`, {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
  });
});
