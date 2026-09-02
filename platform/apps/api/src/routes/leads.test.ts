import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';

const db = {
  organizations: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  leads: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
  deals: { updateMany: vi.fn() },
  activities: { updateMany: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
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
    const res = await app.request('/leads/lead-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ status: 'converted' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s for an unknown lead', async () => {
    db.leads.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/leads/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ status: 'contacted' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /leads/:id/convert', () => {
  it('409s if the lead has already converted', async () => {
    db.leads.findFirst.mockResolvedValue({
      id: 'lead-1',
      converted_organization_id: 'org-existing',
    });
    const app = await buildApp();
    const res = await app.request('/leads/lead-1/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: 'Acme Corp' }),
    });
    expect(res.status).toBe(409);
  });

  it('422s when neither organizationId nor organizationName is given', async () => {
    const app = await buildApp();
    const res = await app.request('/leads/lead-1/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('creates a new organization, converts the lead, and audits it', async () => {
    db.leads.findFirst.mockResolvedValue({ id: 'lead-1', converted_organization_id: null });
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
    const res = await app.request('/leads/lead-1/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', INTERNAL_ORG_ID)) },
      body: JSON.stringify({ organizationName: 'Acme Corp' }),
    });

    expect(res.status).toBe(200);
    expect(db.leads.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ converted_organization_id: 'org-new', status: 'converted' }),
      }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'lead.converted' }) }),
    );
  });
});
