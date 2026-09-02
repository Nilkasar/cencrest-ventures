import { describe, expect, it, vi, beforeEach } from 'vitest';

const findMany = vi.fn();

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn({ ai_runs: { findMany } })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countTrackedCompetitors', () => {
  it('counts DISTINCT competitor ids with at least one ai_runs row, not total run count', async () => {
    findMany.mockResolvedValue([{ competitor_id: 'c1' }, { competitor_id: 'c2' }]);
    const { countTrackedCompetitors } = await import('./competitor-usage.js');

    const count = await countTrackedCompetitors('org-1', 'brand-1');

    expect(count).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: 'org-1', brand_id: 'brand-1', competitor_id: { not: null } },
        distinct: ['competitor_id'],
      }),
    );
  });

  it('is 0 when no competitor has ever been run', async () => {
    findMany.mockResolvedValue([]);
    const { countTrackedCompetitors } = await import('./competitor-usage.js');
    expect(await countTrackedCompetitors('org-1', 'brand-1')).toBe(0);
  });
});
