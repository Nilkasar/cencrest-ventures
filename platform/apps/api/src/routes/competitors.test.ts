import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  competitors: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  subscriptions: { findUnique: vi.fn() },
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
  brands: db.brands,
  competitors: db.competitors,
  subscriptions: db.subscriptions,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: competitors } = await import('./competitors.js');
  const app = new Hono();
  app.route('/competitors', competitors);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1' };

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.subscriptions.findUnique.mockResolvedValue({ plan: 'free' });
});

describe('GET /competitors', () => {
  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/competitors', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('lists the org brand\'s competitors', async () => {
    db.competitors.findMany.mockResolvedValue([
      {
        id: 'c-1',
        name: 'Rival Co',
        website_url: null,
        description: null,
        competition_type: 'direct',
        priority: 1,
        aliases: [],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const app = await buildApp();
    const res = await app.request('/competitors', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'c-1', name: 'Rival Co', priority: 1 });
  });
});

describe('POST /competitors — entitlement enforcement (free plan = 2)', () => {
  it('403s for a viewer (below create_brand_profile)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival Co' }),
    });
    expect(res.status).toBe(403);
  });

  it('creates the 1st and 2nd competitor fine (under the free-plan limit of 2)', async () => {
    db.competitors.count.mockResolvedValue(0);
    db.competitors.create.mockResolvedValue({
      id: 'c-1',
      name: 'Rival One',
      website_url: null,
      description: null,
      competition_type: null,
      priority: 1,
      aliases: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival One' }),
    });

    expect(res.status).toBe(201);
    expect(db.competitors.create).toHaveBeenCalled();
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'competitor.created' }) }),
    );
  });

  it('REJECTS the 3rd competitor on the free plan with a specific, actionable 402 — not a generic 403', async () => {
    // The org already has 2 non-deleted competitors tracked (the free
    // plan's limit) — this is the exact scenario the epic brief calls
    // "the first epic where an entitlement check is load-bearing."
    db.competitors.count.mockResolvedValue(2);

    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival Three' }),
    });

    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'competitor_limit_reached',
      metric: 'competitors_tracked',
      limit: 2,
      current: 2,
      plan: 'free',
      upgradeTo: 'starter',
    });
    // The message must name the limit AND the upgrade path, per the epic
    // brief — not a bare "Forbidden".
    expect(body.message).toMatch(/2 competitors/);
    expect(body.message).toMatch(/starter/);
    // And the row must never have been created.
    expect(db.competitors.create).not.toHaveBeenCalled();
  });

  it('does not reject on the growth plan at the same count (limit is 10, not 2)', async () => {
    db.subscriptions.findUnique.mockResolvedValue({ plan: 'growth' });
    db.competitors.count.mockResolvedValue(2);
    db.competitors.create.mockResolvedValue({
      id: 'c-3',
      name: 'Rival Three',
      website_url: null,
      description: null,
      competition_type: null,
      priority: 1,
      aliases: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival Three' }),
    });

    expect(res.status).toBe(201);
  });

  it('404s (no brand) before even reaching the entitlement check', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival Co' }),
    });
    expect(res.status).toBe(404);
    expect(db.competitors.count).not.toHaveBeenCalled();
  });

  it('422s for an invalid priority value', async () => {
    const app = await buildApp();
    const res = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1', 'org-1')) },
      body: JSON.stringify({ name: 'Rival Co', priority: 'urgent' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /competitors/:id', () => {
  it('404s for an unknown id', async () => {
    db.competitors.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/competitors/nope', {
      method: 'DELETE',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(404);
  });

  it('soft-deletes (sets deleted_at, does not hard-delete)', async () => {
    db.competitors.findFirst.mockResolvedValue({ id: 'c-1', organization_id: 'org-1' });
    db.competitors.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.request('/competitors/c-1', {
      method: 'DELETE',
      headers: await authHeader('user-1', 'org-1'),
    });
    expect(res.status).toBe(200);
    expect(db.competitors.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1' }, data: expect.objectContaining({ deleted_at: expect.any(Date) }) }),
    );
  });
});
