import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  memberships: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  invitations: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  users: { findUnique: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

// A single fake transaction object reused by both withUserContext calls in
// orgs.ts (create-org, accept-invitation) — good enough since neither test
// below needs real transactional isolation, just the right method shapes.
const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  invitations: db.invitations,
  users: db.users,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: orgs } = await import('./orgs.js');
  const app = new Hono();
  app.route('/orgs', orgs);
  return app;
}

async function authHeader(userId: string, orgId: string | null = null) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.audit_events.create.mockResolvedValue({});
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
  db.users.findUnique.mockResolvedValue({
    id: 'user-1',
    email: 'a@example.com',
    name: 'Ada',
    deleted_at: null,
  });
});

describe('POST /orgs (create)', () => {
  it('rejects a name that is too short', async () => {
    const app = await buildApp();
    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'a' }),
    });
    expect(res.status).toBe(422);
  });

  it('409s when the slug is already taken', async () => {
    db.organizations.findUnique.mockResolvedValue({ id: 'existing', slug: 'acme' });
    const app = await buildApp();

    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(409);
  });

  it('creates the org AND an owner membership for the creator', async () => {
    db.organizations.findUnique.mockResolvedValue(null);
    db.organizations.create.mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme' });
    db.memberships.create.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'Acme' }),
    });

    expect(res.status).toBe(201);
    expect(db.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'owner' }) }),
    );
  });
});

describe('GET /orgs/:slug', () => {
  it('404s for an unknown slug', async () => {
    db.organizations.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/orgs/nope', { headers: await authHeader('user-1') });
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not a member', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/orgs/acme', { headers: await authHeader('user-1') });
    expect(res.status).toBe(403);
  });

  it('returns the org for a member', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/orgs/acme', { headers: await authHeader('user-1') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'org-1', name: 'Acme', slug: 'acme', role: 'viewer' });
  });
});

describe('DELETE /orgs/:slug (owner-only, always audited)', () => {
  it('403s for a non-owner even if they are an admin', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    const app = await buildApp();
    const res = await app.request('/orgs/acme', { method: 'DELETE', headers: await authHeader('user-1') });
    expect(res.status).toBe(403);
  });

  it('soft-deletes for the owner and writes an audit event', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    db.organizations.update.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/orgs/acme', { method: 'DELETE', headers: await authHeader('user-1') });

    expect(res.status).toBe(200);
    expect(db.organizations.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: expect.objectContaining({ deleted_at: expect.any(Date) }),
    });
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'organization.deleted', result: 'success' }),
      }),
    );
  });
});

describe('PATCH /orgs/:slug/members/:userId (role change — manage_team)', () => {
  beforeEach(() => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
  });

  it('403s for a viewer (below manage_team permission)', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/orgs/acme/members/user-2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses to change the owner's role even for another owner", async () => {
    db.memberships.findFirst
      .mockResolvedValueOnce({ role: 'owner' }) // tenant-context check for the caller
      .mockResolvedValueOnce({ id: 'm-2', role: 'owner' }); // the target lookup in the handler

    const app = await buildApp();
    const res = await app.request('/orgs/acme/members/user-2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(res.status).toBe(403);
  });

  it('an admin can promote a viewer to editor, and it is audited', async () => {
    db.memberships.findFirst
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'm-2', role: 'viewer' });
    db.memberships.update.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/orgs/acme/members/user-2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ role: 'editor' }),
    });

    expect(res.status).toBe(200);
    expect(db.memberships.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'editor' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'membership.role_changed' }),
      }),
    );
  });
});

describe('POST /orgs/invitations/accept', () => {
  it('404s for an unknown token', async () => {
    db.invitations.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/orgs/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ token: 'bogus' }),
    });
    expect(res.status).toBe(404);
  });

  it('403s when the invitation was sent to a different email than the caller', async () => {
    db.invitations.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'someone-else@example.com',
      accepted_at: null,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      organization_id: 'org-1',
      role: 'viewer',
      invited_by: 'user-9',
    });
    const app = await buildApp();
    const res = await app.request('/orgs/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ token: 'tok' }),
    });
    expect(res.status).toBe(403);
  });

  it('creates a membership at the invited role when everything checks out', async () => {
    db.invitations.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'a@example.com',
      accepted_at: null,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      organization_id: 'org-1',
      role: 'editor',
      invited_by: 'user-9',
    });
    db.invitations.update.mockResolvedValue({});
    db.memberships.findFirst.mockResolvedValue(null);
    db.memberships.create.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/orgs/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ token: 'tok' }),
    });

    expect(res.status).toBe(200);
    expect(db.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'editor' }) }),
    );
  });
});
