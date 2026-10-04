import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  competitors: { count: vi.fn() },
  use_cases: { count: vi.fn() },
  brands: { updateMany: vi.fn() },
  crawl_jobs: { findFirst: vi.fn() },
  query_sets: { findFirst: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_org: string, fn: (t: unknown) => unknown) => fn(tx)),
}));

const getBrandForOrg = vi.fn();
vi.mock('../brand-context.js', () => ({ getBrandForOrg }));

const startCrawlForBrand = vi.fn();
vi.mock('../crawler/start-crawl.js', () => ({ startCrawlForBrand }));

const ensureActiveQuerySet = vi.fn();
vi.mock('../agents/ensure-query-universe.js', () => ({ ensureActiveQuerySet }));

const ORG = 'org-1';
const USER = 'user-1';

function brand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brand-1',
    organization_id: ORG,
    name: 'Acme',
    website_url: 'https://acme.example',
    industries: ['SaaS'],
    onboarding_completed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getBrandForOrg.mockResolvedValue(brand());
  tx.competitors.count.mockResolvedValue(2);
  tx.use_cases.count.mockResolvedValue(3);
  tx.brands.updateMany.mockResolvedValue({ count: 1 });
  tx.crawl_jobs.findFirst.mockResolvedValue(null);
  tx.query_sets.findFirst.mockResolvedValue(null);
  startCrawlForBrand.mockResolvedValue({ status: 'started', job: { id: 'crawl-1' } });
  ensureActiveQuerySet.mockResolvedValue({ querySet: { id: 'qs-1' }, created: true });
});

async function run() {
  const { completeOnboarding } = await import('./complete.js');
  return completeOnboarding({ organizationId: ORG, userId: USER });
}

describe('completeOnboarding — server-side minimums (mirror the wizard)', () => {
  it('no brand → no_brand', async () => {
    getBrandForOrg.mockResolvedValue(null);
    expect(await run()).toEqual({ error: 'no_brand' });
  });

  it('reports every missing step, in wizard order, and claims nothing', async () => {
    getBrandForOrg.mockResolvedValue(brand({ name: '  ', industries: [] }));
    tx.competitors.count.mockResolvedValue(0);
    tx.use_cases.count.mockResolvedValue(2);
    expect(await run()).toEqual({ error: 'incomplete', missing: ['brand-basics', 'competitors', 'industry', 'use-cases'] });
    expect(tx.brands.updateMany).not.toHaveBeenCalled();
    expect(startCrawlForBrand).not.toHaveBeenCalled();
    expect(ensureActiveQuerySet).not.toHaveBeenCalled();
  });

  it('exactly 3 use cases and 1 competitor is enough (claims are optional)', async () => {
    tx.competitors.count.mockResolvedValue(1);
    tx.use_cases.count.mockResolvedValue(3);
    const result = await run();
    expect('error' in result).toBe(false);
  });

  it('counts only live rows for this brand', async () => {
    await run();
    expect(tx.use_cases.count).toHaveBeenCalledWith({
      where: { organization_id: ORG, brand_id: 'brand-1', deleted_at: null },
    });
    expect(tx.competitors.count).toHaveBeenCalledWith({
      where: { organization_id: ORG, brand_id: 'brand-1', deleted_at: null },
    });
  });
});

describe('completeOnboarding — first completion kicks off crawl + query set', () => {
  it('claims with a conditional update, starts the crawl and creates the query set', async () => {
    const result = await run();
    expect(tx.brands.updateMany).toHaveBeenCalledWith({
      where: { id: 'brand-1', organization_id: ORG, onboarding_completed_at: null },
      data: { onboarding_completed_at: expect.any(Date) },
    });
    expect(startCrawlForBrand).toHaveBeenCalledWith({ organizationId: ORG, brand: expect.objectContaining({ id: 'brand-1' }), userId: USER });
    expect(ensureActiveQuerySet).toHaveBeenCalledWith(ORG, 'brand-1', USER);
    expect(result).toMatchObject({
      alreadyCompleted: false,
      completedAt: expect.any(Date),
      crawl: { status: 'started', jobId: 'crawl-1' },
      querySet: { status: 'created', id: 'qs-1' },
    });
  });

  it('skip reasons: no website, already crawled, crawl in progress, active query set exists', async () => {
    getBrandForOrg.mockResolvedValue(brand({ website_url: null }));
    ensureActiveQuerySet.mockResolvedValue({ querySet: { id: 'qs-old' }, created: false });
    let result = await run();
    expect(result).toMatchObject({
      crawl: { status: 'skipped', reason: 'no_website_url' },
      querySet: { status: 'skipped', reason: 'active_query_set_exists', id: 'qs-old' },
    });
    expect(startCrawlForBrand).not.toHaveBeenCalled();

    getBrandForOrg.mockResolvedValue(brand());
    tx.crawl_jobs.findFirst.mockResolvedValueOnce({ id: 'crawl-done' });
    result = await run();
    expect(result).toMatchObject({ crawl: { status: 'skipped', reason: 'already_crawled', jobId: 'crawl-done' } });
    expect(startCrawlForBrand).not.toHaveBeenCalled();

    startCrawlForBrand.mockResolvedValueOnce({ status: 'skipped', reason: 'crawl_already_in_progress', job: { id: 'crawl-live' } });
    result = await run();
    expect(result).toMatchObject({ crawl: { status: 'skipped', reason: 'crawl_already_in_progress', jobId: 'crawl-live' } });
  });

  it('a kickoff that THROWS releases the claim so a retry can redo it', async () => {
    ensureActiveQuerySet.mockRejectedValueOnce(new Error('db blip'));
    await expect(run()).rejects.toThrow('db blip');
    const calls = tx.brands.updateMany.mock.calls;
    expect(calls).toHaveLength(2);
    const claimedAt = calls[0]![0].data.onboarding_completed_at;
    expect(calls[1]![0]).toEqual({
      where: { id: 'brand-1', organization_id: ORG, onboarding_completed_at: claimedAt },
      data: { onboarding_completed_at: null },
    });
  });
});

describe('completeOnboarding — idempotency', () => {
  it('already completed: starts nothing, reports what exists, keeps the original timestamp', async () => {
    const original = new Date('2026-10-01T10:00:00Z');
    getBrandForOrg.mockResolvedValue(brand({ onboarding_completed_at: original }));
    tx.crawl_jobs.findFirst.mockResolvedValue({ id: 'crawl-1' });
    tx.query_sets.findFirst.mockResolvedValue({ id: 'qs-1' });

    const result = await run();

    expect(result).toEqual({
      completedAt: original,
      alreadyCompleted: true,
      brandId: 'brand-1',
      crawl: { status: 'skipped', reason: 'onboarding_already_completed', jobId: 'crawl-1' },
      querySet: { status: 'skipped', reason: 'onboarding_already_completed', id: 'qs-1' },
    });
    expect(tx.brands.updateMany).not.toHaveBeenCalled();
    expect(startCrawlForBrand).not.toHaveBeenCalled();
    expect(ensureActiveQuerySet).not.toHaveBeenCalled();
  });

  it('lost the claim to a concurrent request: starts nothing', async () => {
    const winnerAt = new Date('2026-10-04T12:00:00Z');
    tx.brands.updateMany.mockResolvedValueOnce({ count: 0 });
    getBrandForOrg
      .mockResolvedValueOnce(brand())
      .mockResolvedValueOnce(brand({ onboarding_completed_at: winnerAt }));

    const result = await run();

    expect(result).toMatchObject({ alreadyCompleted: true, completedAt: winnerAt });
    expect(startCrawlForBrand).not.toHaveBeenCalled();
    expect(ensureActiveQuerySet).not.toHaveBeenCalled();
  });
});
