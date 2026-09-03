import { describe, expect, it } from 'vitest';
import { analyzeFreeSnapshotSeo } from './seo-analysis.js';
import type { FreeSnapshotCrawlResult, FreeSnapshotPage } from './crawl.js';

function page(overrides: Partial<FreeSnapshotPage> = {}): FreeSnapshotPage {
  return {
    url: 'https://acme.example/',
    isHomepage: false,
    statusCode: 200,
    title: 'Acme',
    metaDescription: 'Acme homepage',
    h1: 'Welcome',
    canonicalUrl: 'https://acme.example/',
    wordCount: 500,
    schemaTypes: [],
    issues: [],
    ...overrides,
  };
}

function crawlResult(pages: FreeSnapshotPage[]): FreeSnapshotCrawlResult {
  return { rootUrl: 'https://acme.example/', pages, pagesCrawled: pages.length, pagesFailed: 0, rootFetchFailed: null };
}

describe('analyzeFreeSnapshotSeo', () => {
  it('reuses Epic 4\'s runTechnicalChecklist to add the HTTPS and homepage-schema checks on top of crawl-time issues', () => {
    const homepage = page({ url: 'http://acme.example/', isHomepage: true }); // http, not https
    const result = analyzeFreeSnapshotSeo(crawlResult([homepage]));

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.pages[0]!.checks.some((c) => c.id === 'https' && !c.passed)).toBe(true);
    expect(result.pages[0]!.checks.some((c) => c.id === 'homepage_organization_schema' && !c.passed)).toBe(true);
    expect(result.issues.some((i) => i.issueType === 'not_https')).toBe(true);
    expect(result.issues.some((i) => i.issueType === 'missing_schema')).toBe(true);
  });

  it('reuses Epic 4\'s runContentChecklist for the brand-level content score', () => {
    const thin = page({ wordCount: 50, schemaTypes: [] });
    const rich = page({ wordCount: 900, schemaTypes: ['Organization'] });
    const result = analyzeFreeSnapshotSeo(crawlResult([thin, rich]));

    // 1 of 2 thin (50%), 1 of 2 with schema (50%) — matches
    // runContentChecklist's documented 50/50 weighting exactly.
    expect(result.contentScore).toBe(50);
  });

  it('averages per-page technical scores and folds crawl-time issues into the flattened issue list for report.ts to rank', () => {
    const good = page({});
    const bad = page({
      url: 'https://acme.example/thin',
      title: null,
      issues: [{ issue_type: 'missing_title', severity: 'high', detail: null }],
    });
    const result = analyzeFreeSnapshotSeo(crawlResult([good, bad]));

    expect(result.issues.some((i) => i.issueType === 'missing_title' && i.pageUrl === bad.url)).toBe(true);
    expect(result.averageTechnicalScore).toBeLessThan(100);
    expect(result.averageTechnicalScore).toBeGreaterThan(0);
  });

  it('handles an empty page set (root fetch failed) without throwing', () => {
    const result = analyzeFreeSnapshotSeo(crawlResult([]));
    expect(result.pagesAnalyzed).toBe(0);
    expect(result.contentScore).toBe(0);
    expect(result.averageTechnicalScore).toBe(0);
    expect(result.issues).toEqual([]);
  });
});
