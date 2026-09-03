import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const organizationsFindUnique = vi.fn();
const membershipsFindFirst = vi.fn();
// Epic 18 — backs `lib/agency-access.ts`'s fallback lookup, exercised only
// when `membershipsFindFirst` resolves null (no direct membership). Default
// `[]` so every PRE-EXISTING test below (which never sets this) resolves
// "no agency access either" and keeps its original 403, unchanged.
const membershipsFindMany = vi.fn();
const agencyClientsFindFirst = vi.fn();

vi.mock('@bebest/database', () => ({
  db: {
    organizations: { findUnique: organizationsFindUnique },
  },
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ memberships: { findFirst: membershipsFindFirst, findMany: membershipsFindMany } }),
  ),
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ agency_clients: { findFirst: agencyClientsFindFirst } }),
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
    membershipsFindMany.mockReset().mockResolvedValue([]);
    agencyClientsFindFirst.mockReset();
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
    membershipsFindMany.mockReset().mockResolvedValue([]);
    agencyClientsFindFirst.mockReset();
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

// Epic 18 (Agency / White Label / Integrations) — the composed
// authorization check (`lib/agency-access.ts`) exercised through the exact
// same `requireOrgFromToken` entry point every other tenant route uses.
// This is the DoD's mandated proof: "a test proving revoking an
// `agency_clients` link immediately blocks a subsequent request that was
// previously authorized (not just that new links are checked)."
describe('requireOrgFromToken — agency-mediated access (Epic 18)', () => {
  beforeEach(() => {
    organizationsFindUnique.mockReset();
    membershipsFindFirst.mockReset();
    membershipsFindMany.mockReset();
    agencyClientsFindFirst.mockReset();
  });

  it('grants context via an active agency_clients link when there is no direct membership', async () => {
    organizationsFindUnique.mockResolvedValue({ id: 'client-org', slug: 'client', name: 'Client Co', deleted_at: null });
    membershipsFindFirst.mockResolvedValue(null); // no direct membership in the client org
    membershipsFindMany.mockResolvedValue([{ organization_id: 'agency-org', role: 'admin' }]);
    agencyClientsFindFirst.mockResolvedValue({ id: 'link-1', access_level: 'full', status: 'active' });

    const { requireOrgFromToken } = await import('./tenant-context.js');
    const app = new Hono();
    app.get('/me/resource', fakeAuth('client-org'), requireOrgFromToken('viewer'), (c) => c.json(c.get('org')));

    const res = await app.request('/me/resource');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; viaAgencyOrgId: string };
    expect(body.role).toBe('admin'); // 'full' access_level -> 'admin' role
    expect(body.viaAgencyOrgId).toBe('agency-org');
  });

  it('CRITICAL: revoking the agency_clients link immediately blocks the very next request', async () => {
    organizationsFindUnique.mockResolvedValue({ id: 'client-org', slug: 'client', name: 'Client Co', deleted_at: null });
    membershipsFindFirst.mockResolvedValue(null);
    membershipsFindMany.mockResolvedValue([{ organization_id: 'agency-org', role: 'admin' }]);

    const { requireOrgFromToken } = await import('./tenant-context.js');
    const app = new Hono();
    app.get('/me/resource', fakeAuth('client-org'), requireOrgFromToken('viewer'), (c) => c.json(c.get('org')));

    // Request 1: link is active -> authorized.
    agencyClientsFindFirst.mockResolvedValueOnce({ id: 'link-1', access_level: 'full', status: 'active' });
    const first = await app.request('/me/resource');
    expect(first.status).toBe(200);

    // The link is revoked (its RLS-scoped query now excludes it — the
    // `WHERE status: 'active'` clause `agency-access.ts` uses no longer
    // matches, exactly as it wouldn't against a real revoked row).
    agencyClientsFindFirst.mockResolvedValueOnce(null);

    // Request 2, same user, same token org claim, no restart/cache
    // anywhere in between: must now be rejected.
    const second = await app.request('/me/resource');
    expect(second.status).toBe(403);
  });

  it('rejects a user from a third, unrelated org (no membership anywhere with a link to this client)', async () => {
    organizationsFindUnique.mockResolvedValue({ id: 'client-org', slug: 'client', name: 'Client Co', deleted_at: null });
    membershipsFindFirst.mockResolvedValue(null);
    // The caller belongs to some other, unrelated org that has no
    // agency_clients link to this client at all.
    membershipsFindMany.mockResolvedValue([{ organization_id: 'unrelated-org', role: 'owner' }]);
    agencyClientsFindFirst.mockResolvedValue(null);

    const { requireOrgFromToken } = await import('./tenant-context.js');
    const app = new Hono();
    app.get('/me/resource', fakeAuth('client-org'), requireOrgFromToken('viewer'), (c) => c.json({ ok: true }));

    const res = await app.request('/me/resource');
    expect(res.status).toBe(403);
  });

  it("does not affect the client org's own direct member (checked before any agency fallback)", async () => {
    organizationsFindUnique.mockResolvedValue({ id: 'client-org', slug: 'client', name: 'Client Co', deleted_at: null });
    membershipsFindFirst.mockResolvedValue({ role: 'editor' }); // a REAL, direct membership
    // Even if membershipsFindMany/agencyClientsFindFirst were set up to
    // grant broader access, the direct-membership branch returns first and
    // never consults them.
    membershipsFindMany.mockResolvedValue([{ organization_id: 'some-agency', role: 'owner' }]);
    agencyClientsFindFirst.mockResolvedValue({ id: 'link-x', access_level: 'full', status: 'active' });

    const { requireOrgFromToken } = await import('./tenant-context.js');
    const app = new Hono();
    app.get('/me/resource', fakeAuth('client-org'), requireOrgFromToken('viewer'), (c) => c.json(c.get('org')));

    const res = await app.request('/me/resource');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; viaAgencyOrgId?: string };
    expect(body.role).toBe('editor'); // the direct membership's own role, not the agency link's
    expect(body.viaAgencyOrgId).toBeUndefined();
  });
});
