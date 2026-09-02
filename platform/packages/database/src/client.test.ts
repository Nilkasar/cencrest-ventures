import { describe, expect, it, vi, beforeEach } from 'vitest';

// We need to control the module-level `db` singleton before importing
// `client.ts`, so we mock `@prisma/client` first (hoisted by vitest) and
// then dynamically import the module under test in each case.
const executeRawMock = vi.fn().mockResolvedValue(undefined);
const transactionMock = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ $executeRaw: executeRawMock }),
);

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      $transaction: transactionMock,
      $executeRaw: executeRawMock,
    })),
  };
});

describe('withOrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ $executeRaw: executeRawMock }),
    );
  });

  it('rejects a non-UUID organizationId without touching the database', async () => {
    const { withOrgContext, InvalidOrganizationIdError } = await import('./client.js');

    await expect(withOrgContext('not-a-uuid', async () => 'unreachable')).rejects.toThrow(
      InvalidOrganizationIdError,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('sets app.current_org via set_config before running the callback', async () => {
    const { withOrgContext } = await import('./client.js');
    const orgId = '11111111-1111-4111-8111-111111111111';

    const result = await withOrgContext(orgId, async (tx) => {
      // The callback receives the transaction client, not the base client.
      expect(tx).toBeDefined();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
  });

  it('accepts uppercase UUIDs (case-insensitive)', async () => {
    const { withOrgContext } = await import('./client.js');
    const orgId = '11111111-1111-4111-8111-111111111111'.toUpperCase();

    await expect(withOrgContext(orgId, async () => 'ok')).resolves.toBe('ok');
  });

  it.each([
    '',
    '11111111-1111-1111-1111-11111111111', // too short
    '11111111_1111_4111_8111_111111111111', // wrong separators
    "11111111-1111-4111-8111-111111111111'; DROP TABLE organizations; --",
  ])('rejects malformed input %p', async (bad) => {
    const { withOrgContext, InvalidOrganizationIdError } = await import('./client.js');
    await expect(withOrgContext(bad, async () => 'unreachable')).rejects.toThrow(
      InvalidOrganizationIdError,
    );
  });
});
