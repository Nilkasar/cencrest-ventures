import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const organizationsFindUnique = vi.fn();
const membershipsFindFirst = vi.fn();

vi.mock('@bebest/database', () => ({
  db: {
    organizations: { findUnique: organizationsFindUnique },
  },
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ memberships: { findFirst: membershipsFindFirst } }),
  ),
}));

// A stand-in for requireAuth that just sets a fixed user, so these tests
// exercise ONLY tenant-context's own logic.
function fakeAuth(tokenOrgId: string | null) {
  return async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', { id: 'user-1', email: 'a@example.com', name: 'Ada', tokenOrgId });
    await next();
  };
}

describe('requireOrgBySlug', () => {
  beforeEach(() => {
    organizationsFindUnique.mockReset();
    membershipsFindFirst.mockReset();
  });

  it('404s when the slug does not resolve to an org', async () => {
    organizationsFindUnique.mockResolvedValue(null);
    const { requireOrgBySlug } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/orgs/:slug', fakeAuth(null), requireOrgBySlug('viewer'), (c) => c.json({ ok: true }));

    const res = await app.request('/orgs/nope');
    expect(res.status).toBe(404);
  });

  it('404s when the org is soft-deleted', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: new Date(),
    });
    const { requireOrgBySlug } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/orgs/:slug', fakeAuth(null), requireOrgBySlug('viewer'), (c) => c.json({ ok: true }));

    const res = await app.request('/orgs/acme');
    expect(res.status).toBe(404);
  });

  it('403s when the user has no membership in the org', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue(null);
    const { requireOrgBySlug } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/orgs/:slug', fakeAuth(null), requireOrgBySlug('viewer'), (c) => c.json({ ok: true }));

    const res = await app.request('/orgs/acme');
    expect(res.status).toBe(403);
  });

  it('403s when the membership role is below the required minimum', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'viewer' });
    const { requireOrgBySlug } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/orgs/:slug', fakeAuth(null), requireOrgBySlug('admin'), (c) => c.json({ ok: true }));

    const res = await app.request('/orgs/acme');
    expect(res.status).toBe(403);
  });

  it('sets a DB-verified org context and proceeds when authorized', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'admin' });
    const { requireOrgBySlug } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/orgs/:slug', fakeAuth(null), requireOrgBySlug('admin'), (c) =>
      c.json(c.get('org')),
    );

    const res = await app.request('/orgs/acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      role: 'admin',
    });
  });
});

describe('requireOrgFromToken', () => {
  beforeEach(() => {
    organizationsFindUnique.mockReset();
    membershipsFindFirst.mockReset();
  });

  it('409s when the token has no org claim yet', async () => {
    const { requireOrgFromToken } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/me/resource', fakeAuth(null), requireOrgFromToken('viewer'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/me/resource');
    expect(res.status).toBe(409);
  });

  it('403s (fails closed) if membership was revoked since the token was issued', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue(null); // revoked
    const { requireOrgFromToken } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/me/resource', fakeAuth('org-1'), requireOrgFromToken('viewer'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/me/resource');
    expect(res.status).toBe(403);
  });

  it('resolves org context from the token org claim when membership is still valid', async () => {
    organizationsFindUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      deleted_at: null,
    });
    membershipsFindFirst.mockResolvedValue({ role: 'owner' });
    const { requireOrgFromToken } = await import('./tenant-context.js');

    const app = new Hono();
    app.get('/me/resource', fakeAuth('org-1'), requireOrgFromToken('viewer'), (c) =>
      c.json(c.get('org')),
    );

    const res = await app.request('/me/resource');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe('owner');
  });
});
