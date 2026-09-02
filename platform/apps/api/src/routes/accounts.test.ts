import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ORG_ID = '44444444-4444-4444-4444-444444444444';

const db = {
  organizations: { findUnique: vi.fn(), findMany: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  leads: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  deals: { findMany: vi.fn() },
  activities: { findMany: vi.fn() },
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
  const { default: accounts } = await import('./accounts.js');
  const app = new Hono();
  app.route('/accounts', accounts);
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
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
});

afterEach(() => {
  if (ORIGINAL_INTERNAL_ORG_ID === undefined) delete process.env.CRM_INTERNAL_ORG_ID;
  else process.env.CRM_INTERNAL_ORG_ID = ORIGINAL_INTERNAL_ORG_ID;
});

describe('GET /accounts', () => {
  it('lists orgs that have a converted lead', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: INTERNAL_ORG_ID,
      slug: 'bebest-internal',
      name: 'BeBest Internal',
      deleted_at: null,
    });
    db.leads.findMany.mockResolvedValue([
      { id: 'lead-1', converted_organization_id: ACCOUNT_ORG_ID, converted_at: new Date('2026-01-01') },
    ]);
    db.leads.count.mockResolvedValue(1);
    db.organizations.findMany.mockResolvedValue([{ id: ACCOUNT_ORG_ID, name: 'Acme Corp', slug: 'acme-corp' }]);

    const app = await buildApp();
    const res = await app.request('/accounts', { headers: await authHeader('user-1', INTERNAL_ORG_ID) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ organizationId: string; name: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({ organizationId: ACCOUNT_ORG_ID, name: 'Acme Corp' });
  });
});

describe('GET /accounts/:orgId', () => {
  it('404s when the organization does not exist', async () => {
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === INTERNAL_ORG_ID) {
        return { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null };
      }
      return null;
    });

    const app = await buildApp();
    const res = await app.request(`/accounts/${ACCOUNT_ORG_ID}`, {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });
    expect(res.status).toBe(404);
  });

  it('404s when the org exists but no lead ever converted into it', async () => {
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === INTERNAL_ORG_ID) {
        return { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null };
      }
      return { id: ACCOUNT_ORG_ID, name: 'Self-serve Co', slug: 'self-serve-co', deleted_at: null };
    });
    db.leads.findFirst.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.request(`/accounts/${ACCOUNT_ORG_ID}`, {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });
    expect(res.status).toBe(404);
  });

  it('returns the org + converted lead + deals + activity timeline together', async () => {
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === INTERNAL_ORG_ID) {
        return { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null };
      }
      return { id: ACCOUNT_ORG_ID, name: 'Acme Corp', slug: 'acme-corp', deleted_at: null, created_at: new Date() };
    });
    db.leads.findFirst.mockResolvedValue({
      id: 'lead-1',
      email: 'lead@acme.com',
      name: 'Lead One',
      company: 'Acme Corp',
      source: 'apply_form',
      converted_at: new Date(),
    });
    db.deals.findMany.mockResolvedValue([
      {
        id: 'deal-1',
        title: 'Full Rebuild',
        value_cents: 6_500_000,
        currency: 'USD',
        stage: 'won',
        owner_id: 'user-2',
        expected_close_date: null,
      },
    ]);
    db.activities.findMany.mockResolvedValue([
      { id: 'act-1', type: 'note', subject: null, body: 'Kickoff', actor_id: 'user-1', created_at: new Date() },
    ]);

    const app = await buildApp();
    const res = await app.request(`/accounts/${ACCOUNT_ORG_ID}`, {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      organization: { id: string };
      lead: { id: string };
      deals: unknown[];
      activities: unknown[];
    };
    expect(body.organization.id).toBe(ACCOUNT_ORG_ID);
    expect(body.lead.id).toBe('lead-1');
    expect(body.deals).toHaveLength(1);
    expect(body.activities).toHaveLength(1);
  });
});
