import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const AGENCY_PLAN_LOW_LIMIT = {
  plans: { slug: 'agency', active: true, limits: { client_accounts: 1 } },
};
const AGENCY_PLAN_ROOMY = {
  plans: { slug: 'agency', active: true, limits: { client_accounts: 20 } },
};

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  users: { findUnique: vi.fn() },
  agency_clients: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  subscriptions: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  ai_runs: { findFirst: vi.fn() },
  unified_opportunities: { count: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  // writeAuditEvent runs org-attributed writes inside withOrgContext now
  // (see lib/audit.ts), so the transaction client exposes audit_events.
  audit_events: db.audit_events,
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  agency_clients: db.agency_clients,
  subscriptions: db.subscriptions,
  brands: db.brands,
  ai_runs: db.ai_runs,
  unified_opportunities: db.unified_opportunities,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: agency } = await import('./agency.js');
  const app = new Hono();
  app.route('/agency', agency);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
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
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
    if (where.id === 'agency-org' || where.slug === 'agency') {
      return { id: 'agency-org', slug: 'agency', name: 'Agency Co', deleted_at: null };
    }
    if (where.id === 'client-org' || where.slug === 'client') {
      return { id: 'client-org', slug: 'client', name: 'Client Co', deleted_at: null };
    }
    return null;
  });
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
  db.subscriptions.findUnique.mockResolvedValue(AGENCY_PLAN_ROOMY);
});

describe('POST /agency/clients — invite (consent required)', () => {
  it('404s when the client org slug does not resolve', async () => {
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id === 'agency-org') return { id: 'agency-org', slug: 'agency', name: 'Agency Co', deleted_at: null };
      return null; // the requested client slug ("nope") does not resolve
    });
    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s when trying to link the agency to itself', async () => {
    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'agency' }),
    });
    expect(res.status).toBe(422);
  });

  it('creates a PENDING link (never active) and audit-logs the invitation', async () => {
    db.agency_clients.findUnique.mockResolvedValue(null);
    db.agency_clients.count.mockResolvedValue(0);
    db.agency_clients.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'link-1',
      created_at: new Date(),
      consented_at: null,
      revoked_at: null,
      ...data,
    }));

    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'client', role: 'analyst' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; role: string };
    expect(body.status).toBe('pending'); // NOT active — consent step required
    expect(body.role).toBe('analyst');
    expect(db.agency_clients.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', access_level: 'limited' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'agency_client.invited' }) }),
    );
  });

  it('409s when an active or pending link to this client already exists', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', status: 'active' });
    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'client' }),
    });
    expect(res.status).toBe(409);
  });

  it('re-invites (back to pending) a previously revoked link rather than erroring', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', status: 'revoked' });
    db.agency_clients.count.mockResolvedValue(0);
    db.agency_clients.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'link-1',
      created_at: new Date(),
      ...data,
    }));

    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'client' }),
    });
    expect(res.status).toBe(201);
    expect(db.agency_clients.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', consented_at: null, revoked_at: null }) }),
    );
  });

  it('402s with the typed entitlement error when the client_accounts limit is reached (Epic 16 real checkUsageLimit)', async () => {
    db.subscriptions.findUnique.mockResolvedValue(AGENCY_PLAN_LOW_LIMIT);
    db.agency_clients.findUnique.mockResolvedValue(null);
    db.agency_clients.count.mockResolvedValue(1); // already at the limit of 1

    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'client' }),
    });

    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; metric: string; limit: number };
    expect(body.error).toBe('client_limit_reached');
    expect(body.metric).toBe('client_accounts');
    expect(body.limit).toBe(1);
    expect(db.agency_clients.create).not.toHaveBeenCalled();
  });

  it('403s for a viewer (below manage_agency_clients)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/agency/clients', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
      body: JSON.stringify({ clientOrgSlug: 'client' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /agency/clients — list with per-client summary', () => {
  it('returns summary: null for a pending (not yet consented) link — no cross-org read happens', async () => {
    db.agency_clients.findMany.mockResolvedValue([
      { id: 'link-1', client_org_id: 'client-org', access_level: 'full', status: 'pending', created_at: new Date(), consented_at: null, revoked_at: null },
    ]);
    const app = await buildApp();
    const res = await app.request('/agency/clients', { headers: await authHeader('user-1', 'agency-org') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ status: string; summary: unknown }>;
    expect(body[0]!.status).toBe('pending');
    expect(body[0]!.summary).toBeNull();
    expect(db.brands.findFirst).not.toHaveBeenCalled();
  });

  it('returns a real AVS + open-opportunity summary for an active link, reusing Epic 7/9 tables', async () => {
    db.agency_clients.findMany.mockResolvedValue([
      { id: 'link-1', client_org_id: 'client-org', access_level: 'full', status: 'active', created_at: new Date(), consented_at: new Date(), revoked_at: null },
    ]);
    db.brands.findFirst.mockResolvedValue({ id: 'brand-1', organization_id: 'client-org' });
    db.ai_runs.findFirst.mockResolvedValue({ ai_visibility_score: '72.50', completed_at: new Date('2026-01-01') });
    db.unified_opportunities.count.mockResolvedValue(4);

    const app = await buildApp();
    const res = await app.request('/agency/clients', { headers: await authHeader('user-1', 'agency-org') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ summary: { aiVisibilityScore: number; openOpportunities: number } }>;
    expect(body[0]!.summary.aiVisibilityScore).toBe(72.5);
    expect(body[0]!.summary.openOpportunities).toBe(4);
  });
});

describe('POST /agency/clients/:id/accept — the consent step (client side)', () => {
  it("404s (never confirms existence) when the link isn't addressed to this org", async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', client_org_id: 'someone-else', status: 'pending' });
    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/accept', {
      method: 'POST',
      headers: await authHeader('user-1', 'client-org'),
    });
    expect(res.status).toBe(404);
  });

  it('409s when the link is not pending (already active/revoked)', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', client_org_id: 'client-org', status: 'active' });
    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/accept', {
      method: 'POST',
      headers: await authHeader('user-1', 'client-org'),
    });
    expect(res.status).toBe(409);
  });

  it('flips a pending link to active, recording who consented', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', client_org_id: 'client-org', status: 'pending' });
    db.agency_clients.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'link-1',
      ...data,
    }));

    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/accept', {
      method: 'POST',
      headers: await authHeader('user-1', 'client-org'),
    });
    expect(res.status).toBe(200);
    expect(db.agency_clients.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active', consented_by: 'user-1' }) }),
    );
  });
});

describe('POST /agency/clients/:id/revoke — critical: blocks subsequent access (DoD)', () => {
  it('the agency side can revoke an active link', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', agency_org_id: 'agency-org', client_org_id: 'client-org', status: 'active' });
    db.agency_clients.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'link-1', ...data }));

    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/revoke', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('revoked');
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'agency_client.revoked' }) }),
    );
  });

  it('the client side can ALSO revoke the same link', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', agency_org_id: 'agency-org', client_org_id: 'client-org', status: 'active' });
    db.agency_clients.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'link-1', ...data }));

    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/revoke', {
      method: 'POST',
      headers: await authHeader('user-1', 'client-org'),
    });
    expect(res.status).toBe(200);
  });

  it('404s for a third, unrelated org (neither side of the link)', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', agency_org_id: 'agency-org', client_org_id: 'client-org', status: 'active' });
    db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id === 'third-org') return { id: 'third-org', slug: 'third', name: 'Third Co', deleted_at: null };
      return null;
    });

    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/revoke', {
      method: 'POST',
      headers: await authHeader('user-1', 'third-org'),
    });
    expect(res.status).toBe(404);
    expect(db.agency_clients.update).not.toHaveBeenCalled();
  });

  it('is idempotent: revoking an already-revoked link just reports its (unchanged) status', async () => {
    db.agency_clients.findUnique.mockResolvedValue({ id: 'link-1', agency_org_id: 'agency-org', client_org_id: 'client-org', status: 'revoked' });

    const app = await buildApp();
    const res = await app.request('/agency/clients/link-1/revoke', {
      method: 'POST',
      headers: await authHeader('user-1', 'agency-org'),
    });
    expect(res.status).toBe(200);
    expect(db.agency_clients.update).not.toHaveBeenCalled();
  });
});

describe('GET /agency/clients/incoming — narrow client-side read path', () => {
  it('lists agencies inviting/managing this org, via the client_org_id filter (plain db, not RLS)', async () => {
    db.agency_clients.findMany.mockResolvedValue([
      { id: 'link-1', agency_org_id: 'agency-org', access_level: 'full', status: 'pending', created_at: new Date() },
    ]);
    const app = await buildApp();
    const res = await app.request('/agency/clients/incoming', { headers: await authHeader('user-1', 'client-org') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ agencyOrgName: string; role: string }>;
    expect(body[0]!.agencyOrgName).toBe('Agency Co');
    expect(body[0]!.role).toBe('admin'); // 'full' access_level -> 'admin' role
    expect(db.agency_clients.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ client_org_id: 'client-org' }) }),
    );
  });
});
