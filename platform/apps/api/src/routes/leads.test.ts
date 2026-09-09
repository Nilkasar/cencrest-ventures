import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
// Real UUIDs: a non-UUID path param is now answered 404 before any query
// runs (lib/http-params.ts).
const LEAD_ID = '88888888-8888-4888-8888-888888888888';
const UNKNOWN_LEAD_ID = '99999999-9999-4999-8999-999999999999';

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  leads: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
  deals: { updateMany: vi.fn() },
  activities: { updateMany: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const queryRawMock = vi.fn();

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  leads: db.leads,
  deals: db.deals,
  activities: db.activities,
  // The convert handler locks the lead row with a raw FOR UPDATE select
  // before reading it — see routes/leads.ts.
  $queryRaw: queryRawMock,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: leads } = await import('./leads.js');
  const app = new Hono();
  app.route('/leads', leads);
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

const LEAD_ROW = {
  id: 'lead-1',
  organization_id: INTERNAL_ORG_ID,
  email: 'priya@northwind.com',
  name: 'Priya Raman',
  company: 'Northwind Logistics',
  website: null,
  category: null,
  notes: null,
  source: 'free_snapshot',
  source_url: null,
  status: 'new',
  score: 82,
  assigned_to: 'staff-1',
  snapshot_id: null,
  converted_organization_id: null,
  converted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('GET /leads', () => {
  beforeEach(() => {
    db.leads.findMany.mockResolvedValue([LEAD_ROW]);
    db.leads.count.mockResolvedValue(1);
    db.leads.groupBy.mockResolvedValue([
      { status: 'new', _count: { _all: 3 } },
      { status: 'converted', _count: { _all: 2 } },
    ]);
  });

  it('resolves the assignee server-side instead of leaving the client an id', async () => {
    db.users.findMany.mockResolvedValue([
      { id: 'staff-1', name: 'Ava Chen', email: 'ava@bebestwithai.com' },
    ]);

    const app = await buildApp();
    const res = await app.request('/leads', { headers: await authHeader('user-1', INTERNAL_ORG_ID) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { assignedTo: string; assignedToUser: { name: string } }[] };
    expect(body.data[0]?.assignedTo).toBe('staff-1');
    expect(body.data[0]?.assignedToUser).toMatchObject({ id: 'staff-1', name: 'Ava Chen' });
  });

  it('turns ?q= into a database filter across name, company and email', async () => {
    const app = await buildApp();
    await app.request('/leads?q=north', { headers: await authHeader('user-1', INTERNAL_ORG_ID) });

    const where = db.leads.findMany.mock.calls[0]?.[0]?.where as { OR?: unknown[] };
    expect(where.OR).toEqual([
      { name: { contains: 'north', mode: 'insensitive' } },
      { company: { contains: 'north', mode: 'insensitive' } },
      { email: { contains: 'north', mode: 'insensitive' } },
    ]);
  });

  it('reports status counts across the whole filtered set, not just the page', async () => {
    const app = await buildApp();
    const res = await app.request('/leads?limit=1', {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    const body = (await res.json()) as {
      data: unknown[];
      total: number;
      statusCounts: Record<string, number>;
    };
    // One row on the page, but the counts describe every matching lead.
    expect(body.data).toHaveLength(1);
    expect(body.statusCounts).toEqual({
      new: 3,
      contacted: 0,
      qualified: 0,
      converted: 2,
      lost: 0,
    });
  });

  it('excludes the status filter from the counts so the header stays stable', async () => {
    const app = await buildApp();
    await app.request('/leads?status=new&source=referral', {
      headers: await authHeader('user-1', INTERNAL_ORG_ID),
    });

    const countsWhere = db.leads.groupBy.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(countsWhere.status).toBeUndefined();
    expect(countsWhere.source).toBe('referral');
  });
});

describe('POST /leads', () => {
  it('403s for a viewer (below manage_leads)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ email: 'lead@example.com', name: 'Lead One' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s for an invalid email', async () => {
    const app = await buildApp();
    const res = await app.request('/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ email: 'not-an-email', name: 'Lead One' }),
    });
    expect(res.status).toBe(422);
  });

  it('422s for a website URL that fails the SSRF guard', async () => {
    const app = await buildApp();
    const res = await app.request('/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({
        email: 'lead@example.com',
        name: 'Lead One',
        website: 'http://169.254.169.254/latest/meta-data/',
      }),
    });
    expect(res.status).toBe(422);
  });

  it('creates a lead scoped to the internal org', async () => {
    db.leads.create.mockResolvedValue({
      id: 'lead-1',
      organization_id: INTERNAL_ORG_ID,
      email: 'lead@example.com',
      name: 'Lead One',
      company: null,
      website: null,
      category: null,
      notes: null,
      source: 'direct',
      source_url: null,
      status: 'new',
      score: null,
      assigned_to: null,
      snapshot_id: null,
      converted_organization_id: null,
      converted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ email: 'lead@example.com', name: 'Lead One' }),
    });

    expect(res.status).toBe(201);
    expect(db.leads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: INTERNAL_ORG_ID,
          email: 'lead@example.com',
          created_by: 'user-1',
        }),
      }),
    );
  });
});

describe('PATCH /leads/:id', () => {
  it('rejects setting status to converted directly', async () => {
    const app = await buildApp();
    const res = await app.request(`/leads/${LEAD_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ status: 'converted' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s for an unknown lead', async () => {
    db.leads.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request(`/leads/${UNKNOWN_LEAD_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ status: 'contacted' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /leads/:id/convert', () => {
  // The handler takes a FOR UPDATE row lock before reading the lead, so two
  // simultaneous conversions cannot both see it as unconverted. The mocked
  // transaction has to answer that raw query.
  function lockReturns(convertedOrganizationId: string | null) {
    queryRawMock.mockResolvedValue([
      { id: LEAD_ID, converted_organization_id: convertedOrganizationId },
    ]);
  }

  it('409s if the lead has already converted', async () => {
    lockReturns('org-existing');
    db.leads.findFirst.mockResolvedValue({
      id: 'lead-1',
      converted_organization_id: 'org-existing',
    });
    const app = await buildApp();
    const res = await app.request(`/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: 'Acme Corp' }),
    });
    expect(res.status).toBe(409);
  });

  it('takes a row lock before deciding whether the lead is already converted', async () => {
    // Under READ COMMITTED two simultaneous conversions both read
    // `converted_organization_id` as null and both created an organization
    // — two orgs for one lead. The FOR UPDATE select serialises them.
    lockReturns(null);
    db.leads.findFirst.mockResolvedValue({ id: LEAD_ID, converted_organization_id: null });
    db.organizations.create.mockResolvedValue({ id: 'org-new', name: 'Acme Corp', slug: 'acme-corp' });
    // The internal org must still resolve for requireCrmAccess; only the
    // slug-uniqueness lookup should come back empty.
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) =>
      where.id === INTERNAL_ORG_ID
        ? { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null }
        : null,
    );
    db.leads.update.mockResolvedValue({});
    db.deals.updateMany.mockResolvedValue({ count: 0 });
    db.activities.updateMany.mockResolvedValue({ count: 0 });

    const app = await buildApp();
    await app.request(`/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: 'Acme Corp' }),
    });

    expect(queryRawMock).toHaveBeenCalled();
    const sql = String(queryRawMock.mock.calls[0]?.[0] ?? '');
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it('422s an organization name that slugifies to nothing', async () => {
    // '!!!' produced an organization with slug '' — unreachable by every
    // `:slug` route, and colliding with the next such name.
    const app = await buildApp();
    const res = await app.request(`/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: '!!!' }),
    });
    expect(res.status).toBe(422);
  });

  it('422s when neither organizationId nor organizationName is given', async () => {
    const app = await buildApp();
    const res = await app.request(`/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('creates a new organization, converts the lead, and audits it', async () => {
    lockReturns(null);
    db.leads.findFirst.mockResolvedValue({ id: LEAD_ID, converted_organization_id: null });
    db.organizations.create.mockResolvedValue({ id: 'org-new', name: 'Acme Corp', slug: 'acme-corp' });
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id === INTERNAL_ORG_ID) {
        return { id: INTERNAL_ORG_ID, slug: 'bebest-internal', name: 'BeBest Internal', deleted_at: null };
      }
      return null; // slug lookup during unique-slug generation: nothing taken
    });
    db.leads.update.mockResolvedValue({});
    db.deals.updateMany.mockResolvedValue({ count: 0 });
    db.activities.updateMany.mockResolvedValue({ count: 0 });

    const app = await buildApp();
    const res = await app.request(`/leads/${LEAD_ID}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: 'Acme Corp' }),
    });

    expect(res.status).toBe(200);
    expect(db.leads.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LEAD_ID },
        data: expect.objectContaining({ converted_organization_id: 'org-new', status: 'converted' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'lead.converted' }) }),
    );
  });
});
