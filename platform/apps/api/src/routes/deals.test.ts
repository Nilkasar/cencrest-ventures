import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_USER_ID = '33333333-3333-3333-3333-333333333333';
// Real UUIDs: a non-UUID path param is now answered 404 before any query
// runs (lib/http-params.ts), so 'deal-1' would no longer exercise these
// handlers at all.
const DEAL_ID = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_DEAL_ID = '99999999-9999-4999-8999-999999999999';

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn(), findMany: vi.fn() },
  users: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG_ID;
  db.audit_events.create.mockResolvedValue({});
  // assertInternalStaff: by default every referenced owner IS internal staff.
  db.memberships.findMany.mockResolvedValue([{ user_id: OWNER_USER_ID }]);

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

describe('input the database would have rejected', () => {
  // Each of these produced a 500 before: the schema accepted a value that
  // Postgres then refused. See lib/crm-validation.ts.
  async function post(body: Record<string, unknown>) {
    const app = await buildApp();
    return app.request('/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Deal', ownerId: OWNER_USER_ID, ...body }),
    });
  }

  it('422s on a value beyond a 32-bit integer instead of overflowing the column', async () => {
    expect((await post({ valueCents: 3_000_000_000 })).status).toBe(422);
  });

  it('422s on a currency that is not a supported code', async () => {
    expect((await post({ currency: 'ZZZ' })).status).toBe(422);
  });

  it('normalises currency case before writing', async () => {
    db.deals.create.mockResolvedValue(baseDeal());
    expect((await post({ currency: 'usd' })).status).toBe(201);
    expect(db.deals.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'USD' }) }),
    );
  });

  it('422s when the owner is not a member of the CRM workspace', async () => {
    // A UUID that parses is not a UUID that exists — this used to reach
    // Postgres and come back as a foreign-key violation, i.e. a 500.
    db.memberships.findMany.mockResolvedValue([]);
    expect((await post({})).status).toBe(422);
  });

  it('422s when the account organization does not exist', async () => {
    // Only the ACCOUNT org is missing; the internal org must still resolve
    // or requireCrmAccess rejects the request before the handler runs.
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === INTERNAL_ORG_ID
        ? { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null }
        : null,
    );
    expect((await post({ accountOrganizationId: UNKNOWN_DEAL_ID })).status).toBe(422);
  });

  it('404s a malformed deal id rather than handing it to Postgres', async () => {
    const app = await buildApp();
    const res = await app.request('/deals/not-a-uuid', {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /deals/:id', () => {
  it('rejects a payload that tries to set stage directly', async () => {
    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s for an unknown deal', async () => {
    db.deals.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request(`/deals/${UNKNOWN_DEAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(404);
  });

  // Regression: every camelCase field in the request schema has a
  // snake_case column behind it, and this handler used to spread the parsed
  // body straight into Prisma's `data`. Against a real database that threw
  // PrismaClientValidationError ("Unknown argument `valueCents`") — a 500 on
  // any edit that touched value, probability, close date or lost reason.
  // The mocked client accepts any shape, so the assertion has to be on the
  // arguments, not on the response alone.
  it('writes snake_case columns for every camelCase field it accepts', async () => {
    db.deals.findFirst.mockResolvedValue({ id: 'deal-1' });
    db.deals.update.mockResolvedValue({
      id: 'deal-1',
      lead_id: null,
      account_organization_id: null,
      title: 'Renamed',
      value_cents: 2_000_000,
      currency: 'EUR',
      stage: 'proposal',
      probability: 45,
      expected_close_date: new Date('2026-12-01T00:00:00.000Z'),
      owner_id: OWNER_USER_ID,
      lost_reason: 'undercut',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({
        title: 'Renamed',
        valueCents: 2_000_000,
        currency: 'EUR',
        probability: 45,
        expectedCloseDate: '2026-12-01T00:00:00.000Z',
        lostReason: 'undercut',
        ownerId: OWNER_USER_ID,
      }),
    });

    expect(res.status).toBe(200);
    const data = db.deals.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({
      title: 'Renamed',
      value_cents: 2_000_000,
      currency: 'EUR',
      probability: 45,
      lost_reason: 'undercut',
      owner_id: OWNER_USER_ID,
    });
    expect(data.expected_close_date).toBeInstanceOf(Date);
    // No camelCase key may survive into the Prisma payload.
    for (const key of ['valueCents', 'expectedCloseDate', 'lostReason', 'ownerId']) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('reads and writes inside a single tenant-scoped transaction', async () => {
    const { withOrgContext } = await import('@bebest/database');
    db.deals.findFirst.mockResolvedValue({ id: 'deal-1' });
    db.deals.update.mockResolvedValue({
      id: 'deal-1',
      lead_id: null,
      account_organization_id: null,
      title: 'Renamed',
      value_cents: 0,
      currency: 'USD',
      stage: 'new',
      probability: null,
      expected_close_date: null,
      owner_id: OWNER_USER_ID,
      lost_reason: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    await app.request(`/deals/${DEAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ title: 'Renamed' }),
    });

    // One BEGIN/COMMIT for the whole read-then-write, not two.
    expect(vi.mocked(withOrgContext)).toHaveBeenCalledTimes(1);
  });
});

describe('POST /deals/:id/stage', () => {
  it('403s for an editor (below manage_deals)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s when moving to lost without a lostReason', async () => {
    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'lost' }),
    });
    expect(res.status).toBe(422);
  });

  it('clears the lost reason when a deal moves back out of lost', async () => {
    // Carrying it forward left a won deal reading "lost because: budget" —
    // a contradiction the detail screen shows verbatim, and one nothing
    // else ever clears.
    db.deals.findFirst.mockResolvedValue(baseDeal({ stage: 'lost', lost_reason: 'budget' }));
    db.deals.update.mockResolvedValue(baseDeal({ stage: 'won', lost_reason: null }));

    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });

    expect(res.status).toBe(200);
    expect(db.deals.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lost_reason: null }) }),
    );
  });

  it('transitions the stage and writes an audit event ("moved a $65k deal to Won")', async () => {
    db.deals.findFirst.mockResolvedValue(baseDeal({ stage: 'negotiation' }));
    db.deals.update.mockResolvedValue(baseDeal({ stage: 'won' }));

    const app = await buildApp();
    const res = await app.request(`/deals/${DEAL_ID}/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ stage: 'won' }),
    });

    expect(res.status).toBe(200);
    expect(db.deals.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEAL_ID }, data: expect.objectContaining({ stage: 'won' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'deal.stage_changed', result: 'success' }) }),
    );
  });
});
