import { describe, expect, it } from 'vitest';
import { runContentChecklist, runTechnicalChecklist } from './technical-checklist.js';
import type { page_issues, pages } from '@bebest/database';

function page(overrides: Partial<pages> = {}, issues: Array<Partial<page_issues>> = []): pages & { page_issues: page_issues[] } {
  return {
    id: 'page-1',
    organization_id: 'org-1',
    crawl_job_id: 'job-1',
    brand_id: 'brand-1',
    url: 'https://acme.example/',
    title: 'Home',
    meta_description: 'desc',
    h1: 'Welcome',
    canonical_url: 'https://acme.example/',
    status_code: 200,
    word_count: 500,
    load_ms: 100,
    internal_links: 3,
    external_links: 1,
    schema_types: [],
    raw_html_hash: null,
    crawled_at: new Date('2026-02-01'),
    deleted_at: null,
    ...overrides,
    page_issues: issues.map((issue, i) => ({
      id: `issue-${i}`,
      organization_id: 'org-1',
      brand_id: 'brand-1',
      page_id: 'page-1',
      issue_type: 'thin_content',
      severity: 'medium',
      detail: null,
      created_at: new Date('2026-02-01'),
      ...issue,
    })) as page_issues[],
  } as pages & { page_issues: page_issues[] };
}

describe('runTechnicalChecklist', () => {
  it('a clean https page with no existing issues scores 100', () => {
    const result = runTechnicalChecklist(page(), false);
    expect(result.score).toBe(100);
    expect(result.newIssues).toEqual([]);
  });

  it('flags a non-https page and deducts the medium penalty', () => {
    const result = runTechnicalChecklist(page({ url: 'http://acme.example/' }), false);
    expect(result.score).toBe(92); // 100 - 8 (medium)
    expect(result.newIssues).toEqual([{ issue_type: 'not_https', severity: 'medium', detail: null }]);
  });

  it('does not re-flag a page that already has a not_https issue', () => {
    const result = runTechnicalChecklist(
      page({ url: 'http://acme.example/' }, [{ issue_type: 'not_https', severity: 'medium', detail: null }]),
      false,
    );
    // Existing issue is aggregated (deducted once) but never duplicated.
    expect(result.newIssues).toEqual([]);
    expect(result.score).toBe(92);
  });

  it('aggregates existing page_issues (Epic 3-derived) into the score', () => {
    const result = runTechnicalChecklist(page({}, [{ issue_type: 'thin_content', severity: 'high', detail: '120 words' }]), false);
    expect(result.score).toBe(85); // 100 - 15 (high)
    expect(result.findings.checks).toContainEqual({
      id: 'thin_content',
      passed: false,
      severity: 'high',
      detail: '120 words',
    });
  });

  it('checks for Organization schema only on the homepage', () => {
    const nonHomepage = runTechnicalChecklist(page({ schema_types: [] }), false);
    expect(nonHomepage.findings.checks.find((c) => c.id === 'homepage_organization_schema')).toBeUndefined();

    const homepageMissing = runTechnicalChecklist(page({ schema_types: [] }), true);
    expect(homepageMissing.newIssues).toEqual([
      { issue_type: 'missing_schema', severity: 'low', detail: 'No Organization schema.org markup found on the homepage.' },
    ]);
    expect(homepageMissing.score).toBe(97); // 100 - 3 (low)

    const homepagePresent = runTechnicalChecklist(page({ schema_types: ['Organization'] }), true);
    expect(homepagePresent.newIssues).toEqual([]);
    expect(homepagePresent.score).toBe(100);
  });

  it('never lets the score go below 0 even with many stacked issues', () => {
    const manyIssues = Array.from({ length: 10 }, () => ({ issue_type: 'thin_content' as const, severity: 'high' as const, detail: null }));
    const result = runTechnicalChecklist(page({}, manyIssues), false);
    expect(result.score).toBe(0);
  });
});

describe('runContentChecklist', () => {
  it('scores 0 with no pages', () => {
    expect(runContentChecklist([])).toEqual({
      score: 0,
      findings: { pagesAnalyzed: 0, averageWordCount: 0, thinContentPages: 0, pagesWithSchemaMarkup: 0, pagesWithoutSchemaMarkup: 0 },
    });
  });

  it('computes the hand-checked composite for a fixed fixture', () => {
    const pages_ = [
      page({ word_count: 500, schema_types: ['Organization'] }),
      page({ word_count: 100, schema_types: [] }),
      page({ word_count: 400, schema_types: ['Article'] }),
      page({ word_count: 50, schema_types: [] }),
    ];
    const result = runContentChecklist(pages_);
    // total=1050, avg=round(1050/4)=263; thin (< 300 words): 2 of 4 -> ratio 0.5
    // schema: 2 of 4 -> ratio 0.5
    // score = (1-0.5)*50 + 0.5*50 = 50
    expect(result).toEqual({
      score: 50,
      findings: {
        pagesAnalyzed: 4,
        averageWordCount: 263,
        thinContentPages: 2,
        pagesWithSchemaMarkup: 2,
        pagesWithoutSchemaMarkup: 2,
      },
    });
  });

  it('scores 100 when every page is substantial and schema-marked', () => {
    const pages_ = [page({ word_count: 800, schema_types: ['Organization'] }), page({ word_count: 900, schema_types: ['Article'] })];
    const result = runContentChecklist(pages_);
    expect(result.score).toBe(100);
  });
});
