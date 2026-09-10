import { describe, expect, it, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
const txCreateMock = vi.fn();
const withOrgContextMock = vi.fn(async (_orgId: string, fn: (tx: unknown) => unknown) =>
  fn({ audit_events: { create: txCreateMock } }),
);

vi.mock('@bebest/database', () => ({
  db: { audit_events: { create: createMock } },
  withOrgContext: withOrgContextMock,
}));

const ORG = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({});
  txCreateMock.mockResolvedValue({});
});

const base = {
  userId: null,
  organizationId: null,
  actorType: 'user' as const,
  action: 'auth.login',
  entityType: 'user',
  entityId: null,
  result: 'success' as const,
};

describe('writeAuditEvent', () => {
  // `audit_events` has RLS. Writing an org-attributed row through the
  // un-scoped client was refused with `42501 new row violates row-level
  // security policy` — and because this function swallows its own failures,
  // the trail silently stopped recording under a correct role. See
  // migration 0021.
  it('writes an org-attributed event inside that org context', async () => {
    const { writeAuditEvent } = await import('./audit.js');
    await writeAuditEvent({ ...base, organizationId: ORG, action: 'deal.stage_changed' });

    expect(withOrgContextMock).toHaveBeenCalledWith(ORG, expect.any(Function));
    expect(txCreateMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('writes a platform-level event through the un-scoped client', async () => {
    // Login and logout have no organization to scope to, and the append
    // policy explicitly allows a null organization_id.
    const { writeAuditEvent } = await import('./audit.js');
    await writeAuditEvent(base);

    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, so a failed audit write cannot break the action it records', async () => {
    txCreateMock.mockRejectedValue(new Error('database on fire'));
    const { writeAuditEvent } = await import('./audit.js');

    await expect(
      writeAuditEvent({ ...base, organizationId: ORG }),
    ).resolves.toBeUndefined();
  });

  it('carries every field through to the row', async () => {
    const { writeAuditEvent } = await import('./audit.js');
    await writeAuditEvent({
      ...base,
      organizationId: ORG,
      userId: '22222222-2222-4222-8222-222222222222',
      actorRole: 'admin',
      entityId: '33333333-3333-4333-8333-333333333333',
      ipAddress: '203.0.113.7',
      userAgent: 'probe',
      result: 'failure',
    });

    expect(txCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: ORG,
        user_id: '22222222-2222-4222-8222-222222222222',
        actor_role: 'admin',
        entity_id: '33333333-3333-4333-8333-333333333333',
        ip_address: '203.0.113.7',
        result: 'failure',
      }),
    });
  });
});
