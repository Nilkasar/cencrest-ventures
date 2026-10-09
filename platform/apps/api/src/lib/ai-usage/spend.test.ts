import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = {
  ai_usage: { aggregate: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('coerceDecimalToMicroUsd', () => {
  it('parses a Prisma Decimal-like object exactly, with no float step', async () => {
    const { coerceDecimalToMicroUsd } = await import('./spend.js');
    const decimalLike = { toFixed: (dp: number) => (123.456789).toFixed(dp) };
    expect(coerceDecimalToMicroUsd(decimalLike)).toBe(123_456_789n);
  });

  it('treats a null sum (no ai_usage rows at all) as zero', async () => {
    const { coerceDecimalToMicroUsd } = await import('./spend.js');
    expect(coerceDecimalToMicroUsd(null)).toBe(0n);
    expect(coerceDecimalToMicroUsd(undefined)).toBe(0n);
  });

  it('parses a decimal string', async () => {
    const { coerceDecimalToMicroUsd } = await import('./spend.js');
    expect(coerceDecimalToMicroUsd('0.000001')).toBe(1n);
    expect(coerceDecimalToMicroUsd('9999.999999')).toBe(9_999_999_999n);
  });

  it('never returns a negative figure (no legitimate ai_usage row is negative)', async () => {
    const { coerceDecimalToMicroUsd } = await import('./spend.js');
    expect(coerceDecimalToMicroUsd('-5.000000')).toBe(0n);
  });

  it('a garbage value resolves to zero rather than throwing on the refusal path', async () => {
    const { coerceDecimalToMicroUsd } = await import('./spend.js');
    expect(coerceDecimalToMicroUsd('not a number')).toBe(0n);
    expect(coerceDecimalToMicroUsd(Number.NaN)).toBe(0n);
  });
});

describe('sumOrgAiSpendThisMonth', () => {
  it('sums cost_usd for the current UTC month, scoped to the one org, through withOrgContext (RLS)', async () => {
    db.ai_usage.aggregate.mockResolvedValue({ _sum: { cost_usd: { toFixed: (dp: number) => (41.5).toFixed(dp) } } });
    const { sumOrgAiSpendThisMonth } = await import('./spend.js');
    const { withOrgContext } = await import('@bebest/database');

    const micros = await sumOrgAiSpendThisMonth('org-1', new Date('2026-09-25T12:00:00Z'));

    expect(micros).toBe(41_500_000n);
    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    const where = db.ai_usage.aggregate.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.organization_id).toBe('org-1');
    expect((where.recorded_at as { gte: Date }).gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('returns zero for an org with no spend this month', async () => {
    db.ai_usage.aggregate.mockResolvedValue({ _sum: { cost_usd: null } });
    const { sumOrgAiSpendThisMonth } = await import('./spend.js');
    await expect(sumOrgAiSpendThisMonth('org-1')).resolves.toBe(0n);
  });

  it('PROPAGATES a database failure — a spend check that returns 0 when the store is down is an open valve', async () => {
    db.ai_usage.aggregate.mockRejectedValue(new Error('connection refused'));
    const { sumOrgAiSpendThisMonth } = await import('./spend.js');
    await expect(sumOrgAiSpendThisMonth('org-1')).rejects.toThrow('connection refused');
  });
});
