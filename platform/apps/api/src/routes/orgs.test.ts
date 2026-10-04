import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

// Response bodies in these tests are asserted structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

const db = {
  organizations: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  memberships: {
    // `findMany` defaults to `[]` — it backs Epic 18's `lib/agency-access.ts`
    // fallback (consulted only when `findFirst` resolves null), so every
    // PRE-EXISTING "not a member" test in this file (none of which sets
    // this up) keeps its original "no membership -> 403" outcome.
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  agency_clients: { findFirst: vi.fn() },
  invitations: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  users: { findUnique: vi.fn() },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

// A single fake transaction object reused by both withUserContext calls in
// orgs.ts (create-org, accept-invitation) — good enough since neither test
// below needs real transactional isolation, just the right method shapes.
const tx = {
  // writeAuditEvent runs org-attributed writes inside withOrgContext now
  // (see lib/audit.ts), so the transaction client exposes audit_events.
  audit_events: db.audit_events,
  organizations: db.organizations,
  memberships: db.memberships,
  agency_clients: db.agency_clients,
  invitations: db.invitations,
  users: db.users,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

const notifyMock = vi.fn(async () => ({ inApp: null, email: null, suppressed: [] }));
vi.mock('../lib/notifications/notify.js', () => ({ notify: notifyMock }));

const fakeEmailSender = {
  sendMagicLink: vi.fn(async () => {}),
  sendInvitation: vi.fn(async () => {}),
  sendSnapshotReady: vi.fn(async () => {}),
  sendNotification: vi.fn(async () => {}),
};

async function buildApp() {
  const { createOrgsRoutes } = await import('./orgs.js');
  const app = new Hono();
  app.route('/orgs', createOrgsRoutes(fakeEmailSender));
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

  // Epic 22 Phase 2: a taken slug is resolved with a suffix, not a 409 —
  // the second "john@…" user used to be stranded with no org at all.
  function mockSlugTable(taken: string[]) {
    db.organizations.findMany.mockResolvedValue(taken.map((slug) => ({ slug })));
    db.organizations.createMany.mockImplementation(async ({ data }: { data: { slug: string }[] }) => ({
      count: taken.includes(data[0]!.slug) ? 0 : 1,
    }));
    db.organizations.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = db.organizations.createMany.mock.calls.at(-1)![0].data[0];
      return { id: where.id, name: row.name, slug: row.slug };
    });
  }

  it('resolves a slug collision with a numeric suffix instead of 409', async () => {
    mockSlugTable(['john']);
    db.memberships.create.mockResolvedValue({});
    const app = await buildApp();

    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'john' }),
    });
    expect(res.status).toBe(201);
    expect((await json(res)).slug).toBe('john-2');
    expect(db.organizations.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'organization.created' }) }),
    );
  });

  it('accepts an explicit slug and still resolves its collision', async () => {
    mockSlugTable(['acme-hq']);
    db.memberships.create.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'Acme', slug: 'acme-hq' }),
    });
    expect(res.status).toBe(201);
    expect((await json(res)).slug).toBe('acme-hq-2');
  });

  it('strictSlug: true → 409 slug_taken on collision, no membership created', async () => {
    mockSlugTable(['acme']);
    const app = await buildApp();
    const res = await app.request('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ name: 'Acme', slug: 'acme', strictSlug: true }),
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'Slug already taken', code: 'slug_taken' });
    expect(db.memberships.create).not.toHaveBeenCalled();
  });

  it('422s a malformed explicit slug and a name that slugifies to nothing', async () => {
    const app = await buildApp();
    for (const body of [{ name: 'Acme', slug: 'Not A Slug!' }, { name: '!!!' }]) {
      const res = await app.request('/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
    }
  });

  it('creates the org AND an owner membership for the creator', async () => {
    mockSlugTable([]);
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
    expect(await json(res)).toEqual({ id: 'org-1', name: 'Acme', slug: 'acme', role: 'viewer' });
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

  it('422s without the typed confirmation, and with a wrong one — nothing deleted', async () => {
    db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const app = await buildApp();
    for (const body of [undefined, { confirmName: 'acme' }, { confirmName: 'Acme Inc' }]) {
      const res = await app.request('/orgs/acme', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(422);
      expect((await json(res)).error).toBe('confirmation_mismatch');
    }
    expect(db.organizations.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to delete the internal ops org', async () => {
    db.organizations.findUnique.mockResolvedValue({
      id: 'org-1',
      slug: 'ops',
      name: 'Ops',
      kind: 'internal',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const app = await buildApp();
    const res = await app.request('/orgs/ops', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ confirmName: 'Ops' }),
    });
    expect(res.status).toBe(409);
    expect(db.organizations.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes for the owner with the right confirmation, revokes pending invites, and writes an audit event', async () => {
    const ORG_UUID = '5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    db.organizations.findUnique.mockResolvedValue({
      id: ORG_UUID,
      slug: 'acme',
      name: 'Acme',
      kind: 'customer',
      deleted_at: null,
    });
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    db.organizations.updateMany.mockResolvedValue({ count: 1 });
    db.invitations.updateMany.mockResolvedValue({ count: 2 });

    const app = await buildApp();
    const res = await app.request('/orgs/acme', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ confirmName: ' Acme ' }),
    });

    expect(res.status).toBe(200);
    expect(db.organizations.updateMany).toHaveBeenCalledWith({
      where: { id: ORG_UUID, deleted_at: null },
      data: expect.objectContaining({ deleted_at: expect.any(Date) }),
    });
    expect(db.invitations.updateMany).toHaveBeenCalledWith({
      where: { organization_id: ORG_UUID, accepted_at: null, revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'organization.deleted', result: 'success', entity_id: ORG_UUID }),
      }),
    );
  });
});

describe('PATCH /orgs/:slug (rename)', () => {
  beforeEach(() => {
    db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  });

  async function patch(body: unknown) {
    const app = await buildApp();
    return app.request('/orgs/acme', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify(body),
    });
  }

  it('403s for a role below admin', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
    expect((await patch({ name: 'Acme Two' })).status).toBe(403);
    expect(db.organizations.update).not.toHaveBeenCalled();
  });

  it('renames for an admin and audits old → new', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    db.organizations.update.mockResolvedValue({ id: 'org-1', name: 'Acme Two', slug: 'acme' });
    const res = await patch({ name: '  Acme Two ' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: 'org-1', name: 'Acme Two', slug: 'acme' });
    expect(db.organizations.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: expect.objectContaining({ name: 'Acme Two' }),
    });
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'settings.changed',
          entity_id: 'org-1',
          old_value: { name: 'Acme' },
          new_value: { name: 'Acme Two' },
        }),
      }),
    );
  });

  it('rejects a slug change (slug is immutable in Phase 2) but tolerates the unchanged slug', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const res = await patch({ name: 'Acme Two', slug: 'acme-two' });
    expect(res.status).toBe(422);
    expect((await json(res)).error).toBe('slug_immutable');

    db.organizations.update.mockResolvedValue({ id: 'org-1', name: 'Acme Two', slug: 'acme' });
    expect((await patch({ name: 'Acme Two', slug: 'acme' })).status).toBe(200);
  });

  it('422s an empty / punctuation-only name', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    expect((await patch({ name: '!!!' })).status).toBe(422);
    expect((await patch({})).status).toBe(422);
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

describe('POST /orgs/:slug/invitations (send invite — manage_team)', () => {
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
    const res = await app.request('/orgs/acme/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    expect(res.status).toBe(403);
    expect(fakeEmailSender.sendInvitation).not.toHaveBeenCalled();
  });

  it('an admin invite sends via the real EmailSender, not console.log, with the org name and a real accept URL', async () => {
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    db.invitations.deleteMany.mockResolvedValue({});
    db.invitations.create.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/orgs/acme/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ email: 'new@example.com', role: 'editor' }),
    });

    expect(res.status).toBe(201);
    // The fix under test: this used to be a raw `console.log` call site.
    // It must now go through the same swappable-provider `EmailSender`
    // every other email in this codebase uses.
    expect(fakeEmailSender.sendInvitation).toHaveBeenCalledTimes(1);
    expect(fakeEmailSender.sendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        organizationName: 'Acme',
        inviteUrl: expect.stringContaining('/invitations/accept?token='),
      }),
    );
  });
});

describe('POST /orgs/invitations/accept', () => {
  const live = () => ({
    id: 'inv-1',
    email: 'a@example.com',
    accepted_at: null,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60_000),
    organization_id: 'org-1',
    role: 'editor',
    invited_by: 'user-9',
    organizations: { id: 'org-1', name: 'Acme', slug: 'acme', deleted_at: null },
  });

  async function accept(token = 'tok') {
    const app = await buildApp();
    return app.request('/orgs/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader('user-1')) },
      body: JSON.stringify({ token }),
    });
  }

  it('404s for an unknown token', async () => {
    db.invitations.findFirst.mockResolvedValue(null);
    const res = await accept('bogus');
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe('invalid_token');
  });

  it('403s (email_mismatch, masked address) when the invitation was sent to a different email than the caller', async () => {
    db.invitations.findFirst.mockResolvedValue({ ...live(), email: 'someone-else@example.com' });
    const res = await accept();
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.code).toBe('email_mismatch');
    expect(body.message).toContain('s***@example.com');
    expect(body.message).not.toContain('someone-else');
    expect(db.memberships.create).not.toHaveBeenCalled();
  });

  it('410s an expired invitation, a revoked one, and one for a deleted org', async () => {
    db.invitations.findFirst.mockResolvedValueOnce({ ...live(), expires_at: new Date(Date.now() - 1000) });
    let res = await accept();
    expect(res.status).toBe(410);
    expect((await json(res)).code).toBe('expired');

    db.invitations.findFirst.mockResolvedValueOnce({ ...live(), revoked_at: new Date() });
    res = await accept();
    expect(res.status).toBe(410);
    expect((await json(res)).code).toBe('revoked');

    db.invitations.findFirst.mockResolvedValueOnce({
      ...live(),
      organizations: { id: 'org-1', name: 'Acme', slug: 'acme', deleted_at: new Date() },
    });
    res = await accept();
    expect(res.status).toBe(410);
    expect((await json(res)).code).toBe('organization_deleted');
    expect(db.memberships.create).not.toHaveBeenCalled();
  });

  it('409s an already-accepted invitation', async () => {
    db.invitations.findFirst.mockResolvedValue({ ...live(), accepted_at: new Date() });
    const res = await accept();
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('already_accepted');
  });

  it('409s when a concurrent accept claimed it first (conditional update matched nothing)', async () => {
    db.invitations.findFirst.mockResolvedValue(live());
    db.invitations.updateMany.mockResolvedValue({ count: 0 });
    const res = await accept();
    expect(res.status).toBe(409);
    expect(db.memberships.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('creates a membership at the invited role, returns the slug for select-org, audits, and notifies the inviter', async () => {
    db.invitations.findFirst.mockResolvedValue(live());
    db.invitations.updateMany.mockResolvedValue({ count: 1 });
    db.memberships.findFirst
      .mockResolvedValueOnce(null) // caller not yet a member
      .mockResolvedValueOnce({ id: 'm-inviter' }); // inviter still a member
    db.memberships.create.mockResolvedValue({});

    const res = await accept();

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      success: true,
      organizationId: 'org-1',
      organizationSlug: 'acme',
      organizationName: 'Acme',
      role: 'editor',
      alreadyMember: false,
    });
    expect(db.invitations.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', accepted_at: null, revoked_at: null },
      data: { accepted_at: expect.any(Date) },
    });
    expect(db.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'editor', user_id: 'user-1' }) }),
    );
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'invitation.accepted' }) }),
    );
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', userId: 'user-9', type: 'invitation_accepted' }),
      expect.objectContaining({ emailSender: fakeEmailSender }),
    );
  });

  it('an existing member accepting: 200 alreadyMember, role untouched, no notification', async () => {
    db.invitations.findFirst.mockResolvedValue(live());
    db.invitations.updateMany.mockResolvedValue({ count: 1 });
    db.memberships.findFirst.mockResolvedValueOnce({ id: 'm-1', role: 'admin' });

    const res = await accept();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ alreadyMember: true, role: 'admin' });
    expect(db.memberships.create).not.toHaveBeenCalled();
    expect(db.memberships.update).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a notification failure does not fail the accept', async () => {
    db.invitations.findFirst.mockResolvedValue(live());
    db.invitations.updateMany.mockResolvedValue({ count: 1 });
    db.memberships.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'm-inviter' });
    db.memberships.create.mockResolvedValue({});
    notifyMock.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await accept();
    expect(res.status).toBe(200);
    errSpy.mockRestore();
  });
});

describe('GET /orgs/invitations/preview (public)', () => {
  async function preview(query: string) {
    const app = await buildApp();
    return app.request(`/orgs/invitations/preview${query}`);
  }

  it('needs no auth and returns only the safe fields, email masked', async () => {
    db.invitations.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'john@b.example',
      role: 'analyst',
      accepted_at: null,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      organization_id: 'org-1',
      invited_by: 'user-9',
      token_hash: 'h',
      organizations: { name: 'Acme', deleted_at: null },
      users: { name: 'Ada Owner' },
    });
    const res = await preview('?token=tok');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      organizationName: 'Acme',
      inviterName: 'Ada Owner',
      role: 'analyst',
      email: 'j***@b.example',
      expired: false,
      accepted: false,
    });
  });

  it('reports expired and accepted rather than hiding them', async () => {
    db.invitations.findFirst.mockResolvedValue({
      email: 'john@b.example',
      role: 'viewer',
      accepted_at: new Date(),
      revoked_at: null,
      expires_at: new Date(Date.now() - 1000),
      organizations: { name: 'Acme', deleted_at: null },
      users: { name: 'Ada' },
    });
    const body = await json(await preview('?token=tok'));
    expect(body).toMatchObject({ expired: true, accepted: true });
  });

  it('answers the SAME generic 404 for unknown, revoked, deleted-org and missing tokens (no enumeration)', async () => {
    const bodies: unknown[] = [];

    db.invitations.findFirst.mockResolvedValueOnce(null);
    let res = await preview('?token=unknown');
    expect(res.status).toBe(404);
    bodies.push(await json(res));

    db.invitations.findFirst.mockResolvedValueOnce({
      revoked_at: new Date(),
      organizations: { name: 'Acme', deleted_at: null },
      users: { name: 'Ada' },
    });
    res = await preview('?token=revoked');
    expect(res.status).toBe(404);
    bodies.push(await json(res));

    db.invitations.findFirst.mockResolvedValueOnce({
      revoked_at: null,
      organizations: { name: 'Acme', deleted_at: new Date() },
      users: { name: 'Ada' },
    });
    res = await preview('?token=deleted-org');
    expect(res.status).toBe(404);
    bodies.push(await json(res));

    res = await preview('');
    expect(res.status).toBe(404);
    bodies.push(await json(res));

    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(JSON.stringify(bodies[0])).not.toMatch(/Acme|revoked|deleted/i);
  });

  it('is rate limited as a public endpoint', async () => {
    db.organization_rate_limits.upsert.mockResolvedValue({ count: 31 });
    const res = await preview('?token=tok');
    expect(res.status).toBe(429);
    expect(db.invitations.findFirst).not.toHaveBeenCalled();
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain only', async () => {
    const { maskEmail } = await import('./orgs.js');
    expect(maskEmail('john.smith@acme.example')).toBe('j***@acme.example');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('GET /orgs (list)', () => {
  it('omits soft-deleted organizations', async () => {
    db.memberships.findMany.mockResolvedValueOnce([
      { role: 'owner', organizations: { id: 'o1', name: 'Live', slug: 'live', deleted_at: null } },
      { role: 'owner', organizations: { id: 'o2', name: 'Gone', slug: 'gone', deleted_at: new Date() } },
    ]);
    const app = await buildApp();
    const res = await app.request('/orgs', { headers: await authHeader('user-1') });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([{ id: 'o1', name: 'Live', slug: 'live', role: 'owner' }]);
  });
});
