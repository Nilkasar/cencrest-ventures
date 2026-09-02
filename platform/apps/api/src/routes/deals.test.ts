import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_USER_ID = '33333333-3333-3333-3333-333333333333';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  leads: { findFirst: vi.fn() },
  deals: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  leads: db.leads,
  deals: db.deals,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: deals } = await import('./deals.js');
  const app = new Hono();
  app.route('/deals', deals);
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
  db.audit_events.create.mockResolvedValue({});

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
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
});

afterEach(() => {
  if (ORIGINAL_INTERNAL_ORG_ID === undefined) delete process.env.CRM_INTERNAL_ORG_ID;
  else process.env.CRM_INTERNAL_ORG_ID = ORIGINAL_INTERNAL_ORG_ID;
});

function baseDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-1',
    lead_id: null,
    account_organization_id: null,
    title: 'Full Rebuild engagement',
    value_cents: 6_500_000,
    currency: 'USD',
    stage: 'new',
    probability: null,
    expected_close_date: null,
    owner_id: OWNER_USER_ID,
    lost_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('POST /deals', () => {
  it('403s for an editor (below manage_deals)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Deal', ownerId: OWNER_USER_ID }),
    });
    expect(res.status).toBe(403);
  });

  const LEAD_ID = '55555555-5555-5555-5555-555555555555';
  const ACCOUNT_ORG_ID = '66666666-6666-6666-6666-666666666666';

  it('404s when leadId does not refer to an existing lead', async () => {
    db.leads.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Deal', ownerId: OWNER_USER_ID, leadId: LEAD_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('inherits accountOrganizationId from an already-converted lead', async () => {
    db.leads.findFirst.mockResolvedValue({ id: LEAD_ID, converted_organization_id: ACCOUNT_ORG_ID });
    db.deals.create.mockResolvedValue(
      baseDeal({ lead_id: LEAD_ID, account_organization_id: ACCOUNT_ORG_ID }),
    );

    const app = await buildApp();
    const res = await app.request('/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Deal', ownerId: OWNER_USER_ID, leadId: LEAD_ID }),
    });

    expect(res.status).toBe(201);
    expect(db.deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lead_id: LEAD_ID, account_organization_id: ACCOUNT_ORG_ID }),
      }),
    );
  });

  it('creates a deal scoped to the internal org', async () => {
    db.deals.create.mockResolvedValue(baseDeal());
    const app = await buildApp();
    const res = await app.request('/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Full Rebuild engagement', valueCents: 6_500_000, ownerId: OWNER_USER_ID }),
    });

    expect(res.status).toBe(201);
    expect(db.deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organization_id: INTERNAL_ORG_ID, owner_id: OWNER_USER_ID }),
      }),
    );
  });
});

describe('PATCH /deals/:id', () => {
  it('rejects a payload that tries to set stage directly', async () => {
    const app = await buildApp();
    const res = await app.request('/deals/deal-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s for an unknown deal', async () => {
    db.deals.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/deals/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /deals/:id/stage', () => {
  it('403s for an editor (below manage_deals)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/deals/deal-1/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s when moving to lost without a lostReason', async () => {
    const app = await buildApp();
    const res = await app.request('/deals/deal-1/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'lost' }),
    });
    expect(res.status).toBe(422);
  });

  it('transitions the stage and writes an audit event ("moved a $65k deal to Won")', async () => {
    db.deals.findFirst.mockResolvedValue(baseDeal({ stage: 'negotiation' }));
    db.deals.update.mockResolvedValue(baseDeal({ stage: 'won' }));

    const app = await buildApp();
    const res = await app.request('/deals/deal-1/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });

    expect(res.status).toBe(200);
    expect(db.deals.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'deal-1' }, data: expect.objectContaining({ stage: 'won' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'deal.stage_changed', result: 'success' }) }),
    );
  });
});
