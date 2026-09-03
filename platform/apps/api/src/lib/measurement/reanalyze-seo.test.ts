import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runContentChecklist, runTechnicalChecklist } from '../seo/technical-checklist.js';
import { reanalyzeSeoForBrand } from './reanalyze-seo.js';

const db = {
  crawl_jobs: { findFirst: vi.fn() },
  pages: { findMany: vi.fn() },
  page_issues: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  seo_analyses: { create: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'page-1',
    url: 'https://acme.com/',
    schema_types: ['Organization'],
    word_count: 900,
    page_issues: [],
    ...overrides,
  };
}

let analyzedAtSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  analyzedAtSeq = 0;
  db.crawl_jobs.findFirst.mockResolvedValue(null);
  db.pages.findMany.mockResolvedValue([]);
  db.page_issues.createMany.mockResolvedValue({ count: 0 });
  db.seo_analyses.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `analysis-${++analyzedAtSeq}`,
    analyzed_at: new Date(2026, 1, analyzedAtSeq),
    ...data,
  }));
});

describe('reanalyzeSeoForBrand', () => {
  it('returns null when the brand has no crawl data at all — never fabricates a score', async () => {
    const result = await reanalyzeSeoForBrand('org-1', 'brand-1');
    expect(result).toBeNull();
    expect(db.pages.findMany).not.toHaveBeenCalled();
    expect(db.seo_analyses.create).not.toHaveBeenCalled();
  });

  it('returns null when the most recent crawl job has zero crawled pages', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'job-1', root_url: 'https://acme.com' });
    db.pages.findMany.mockResolvedValue([]);
    const result = await reanalyzeSeoForBrand('org-1', 'brand-1');
    expect(result).toBeNull();
    expect(db.seo_analyses.create).not.toHaveBeenCalled();
  });

  it('calls Epic 4\'s REAL runTechnicalChecklist/runContentChecklist — the aggregated result matches those functions\' own real output, never a reimplementation', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'job-1', root_url: 'https://acme.com' });
    const pages = [
      page({ id: 'page-1', url: 'https://acme.com/', word_count: 900, schema_types: ['Organization'] }),
      page({ id: 'page-2', url: 'https://acme.com/pricing', word_count: 400, schema_types: [] }),
    ];
    db.pages.findMany.mockResolvedValue(pages);

    const result = await reanalyzeSeoForBrand('org-1', 'brand-1');

    // Independently recompute with the SAME real Epic 4 functions this
    // module calls, using the identical isHomepage logic — proves the
    // orchestration reuses them rather than reimplementing the checklist.
    const expectedTechnicalScores = pages.map((p, i) => runTechnicalChecklist(p as never, i === 0).score);
    const expectedContent = runContentChecklist(pages as never);
    const expectedOverall = Math.round(((expectedTechnicalScores[0]! + expectedTechnicalScores[1]!) / 2 + expectedContent.score) / 2 * 100) / 100;

    expect(result).not.toBeNull();
    expect(result!.pagesAnalyzed).toBe(2);
    expect(result!.contentScore).toBe(expectedContent.score);
    expect(result!.overallScore).toBe(expectedOverall);

    // One technical seo_analyses row per page, plus one content row.
    const technicalCalls = db.seo_analyses.create.mock.calls.filter(([arg]) => arg.data.analysis_type === 'technical');
    const contentCalls = db.seo_analyses.create.mock.calls.filter(([arg]) => arg.data.analysis_type === 'content');
    expect(technicalCalls).toHaveLength(2);
    expect(contentCalls).toHaveLength(1);
  });

  it('flags the crawl job\'s own root_url page as the homepage — schema check applies only there', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'job-1', root_url: 'https://acme.com' });
    const homepage = page({ id: 'page-1', url: 'https://acme.com/', schema_types: [] }); // no schema -> homepage check should fail
    db.pages.findMany.mockResolvedValue([homepage]);

    await reanalyzeSeoForBrand('org-1', 'brand-1');

    const [{ data }] = db.seo_analyses.create.mock.calls[0]!;
    const checks = (data.findings as { checks: Array<{ id: string; passed: boolean }> }).checks;
    const schemaCheck = checks.find((c) => c.id.toLowerCase().includes('schema'));
    expect(schemaCheck?.passed).toBe(false);
  });

  it('persists any newly-found issues via page_issues.createMany, scoped to the right org/brand/page', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'job-1', root_url: 'https://acme.com' });
    // http (not https) triggers the "missing HTTPS" new-issue check this
    // module's real runTechnicalChecklist call surfaces.
    db.pages.findMany.mockResolvedValue([page({ id: 'page-1', url: 'http://acme.com/' })]);

    await reanalyzeSeoForBrand('org-1', 'brand-1');

    expect(db.page_issues.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ organization_id: 'org-1', brand_id: 'brand-1', page_id: 'page-1' })]),
      }),
    );
  });

  it('writes new rows every call — a second re-run produces fresh evidence, never overwrites the prior analysis', async () => {
    db.crawl_jobs.findFirst.mockResolvedValue({ id: 'job-1', root_url: 'https://acme.com' });
    db.pages.findMany.mockResolvedValue([page()]);

    await reanalyzeSeoForBrand('org-1', 'brand-1');
    await reanalyzeSeoForBrand('org-1', 'brand-1');

    const technicalCreateCount = db.seo_analyses.create.mock.calls.filter(([arg]) => arg.data.analysis_type === 'technical').length;
    expect(technicalCreateCount).toBe(2); // one per call, not deduped/overwritten
  });
});
