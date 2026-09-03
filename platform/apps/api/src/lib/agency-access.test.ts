import { describe, expect, it, vi, beforeEach } from 'vitest';

const membershipsFindMany = vi.fn();
const agencyClientsFindFirst = vi.fn();

vi.mock('@bebest/database', () => ({
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ memberships: { findMany: membershipsFindMany } }),
  ),
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ agency_clients: { findFirst: agencyClientsFindFirst } }),
  ),
}));

describe('resolveAgencyAccess', () => {
  beforeEach(() => {
    membershipsFindMany.mockReset();
    agencyClientsFindFirst.mockReset();
  });

  it('returns null when the user has no memberships at all', async () => {
    membershipsFindMany.mockResolvedValue([]);
    const { resolveAgencyAccess } = await import('./agency-access.js');
    expect(await resolveAgencyAccess('user-1', 'client-org')).toBeNull();
    expect(agencyClientsFindFirst).not.toHaveBeenCalled();
  });

  it('returns null when none of the user\'s orgs have a link to this client', async () => {
    membershipsFindMany.mockResolvedValue([{ organization_id: 'org-a', role: 'owner' }]);
    agencyClientsFindFirst.mockResolvedValue(null);
    const { resolveAgencyAccess } = await import('./agency-access.js');
    expect(await resolveAgencyAccess('user-1', 'client-org')).toBeNull();
  });

  it.each([
    ['full', 'admin'],
    ['limited', 'analyst'],
    ['read_only', 'viewer'],
  ] as const)('maps access_level %s to role %s (capped by an owner-rank membership)', async (accessLevel, expectedRole) => {
    membershipsFindMany.mockResolvedValue([{ organization_id: 'agency-org', role: 'owner' }]);
    agencyClientsFindFirst.mockResolvedValue({ id: 'link-1', access_level: accessLevel, status: 'active' });
    const { resolveAgencyAccess } = await import('./agency-access.js');
    const access = await resolveAgencyAccess('user-1', 'client-org');
    expect(access).toEqual({ role: expectedRole, agencyOrgId: 'agency-org', linkId: 'link-1' });
  });

  it("caps the granted role by the user's own rank in the agency org (defense in depth)", async () => {
    // The link grants 'full' (-> admin), but this user is only a 'viewer'
    // at the agency itself — they must not inherit more access to a client
    // than they have at their own org.
    membershipsFindMany.mockResolvedValue([{ organization_id: 'agency-org', role: 'viewer' }]);
    agencyClientsFindFirst.mockResolvedValue({ id: 'link-1', access_level: 'full', status: 'active' });
    const { resolveAgencyAccess } = await import('./agency-access.js');
    const access = await resolveAgencyAccess('user-1', 'client-org');
    expect(access?.role).toBe('viewer');
  });

  it('never treats a pending, paused, terminated, or revoked link as active (query itself filters status)', async () => {
    // agency-access.ts's own query filters `status: 'active'` — simulating
    // the DB returning null (as it would for any non-active row) proves the
    // function has no fallback path that would grant access anyway.
    membershipsFindMany.mockResolvedValue([{ organization_id: 'agency-org', role: 'admin' }]);
    agencyClientsFindFirst.mockResolvedValue(null);
    const { resolveAgencyAccess } = await import('./agency-access.js');
    expect(await resolveAgencyAccess('user-1', 'client-org')).toBeNull();
  });

  it('never checks a membership whose org IS the target client org itself', async () => {
    membershipsFindMany.mockResolvedValue([{ organization_id: 'client-org', role: 'owner' }]);
    const { resolveAgencyAccess } = await import('./agency-access.js');
    expect(await resolveAgencyAccess('user-1', 'client-org')).toBeNull();
    expect(agencyClientsFindFirst).not.toHaveBeenCalled();
  });

  it('tries every membership until one has a link, not just the first', async () => {
    membershipsFindMany.mockResolvedValue([
      { organization_id: 'org-a', role: 'owner' },
      { organization_id: 'org-b', role: 'admin' },
    ]);
    agencyClientsFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'link-2',
      access_level: 'limited',
      status: 'active',
    });
    const { resolveAgencyAccess } = await import('./agency-access.js');
    const access = await resolveAgencyAccess('user-1', 'client-org');
    expect(access).toEqual({ role: 'analyst', agencyOrgId: 'org-b', linkId: 'link-2' });
  });
});

describe('roleToAccessLevel', () => {
  it('round-trips with accessLevelToRole\'s three known values', async () => {
    const { roleToAccessLevel } = await import('./agency-access.js');
    expect(roleToAccessLevel('admin')).toBe('full');
    expect(roleToAccessLevel('analyst')).toBe('limited');
    expect(roleToAccessLevel('viewer')).toBe('read_only');
  });
});
