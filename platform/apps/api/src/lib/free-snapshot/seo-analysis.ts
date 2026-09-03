/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the "basic SEO analysis" step
 * (`docs/epics/17-free-snapshot.md` step 2e: "Run a basic SEO analysis
 * (Epic 4) against the crawled pages").
 *
 * Reuses Epic 4's exact scoring functions (`runTechnicalChecklist`,
 * `runContentChecklist`, both `lib/seo/technical-checklist.ts`) against the
 * in-memory pages `crawl.ts` produced — never a reimplementation of the
 * checklist rules or the scoring weights. Those two functions already take
 * a deliberately narrowed structural type (`TechnicalChecklistPageInput`/
 * `ContentChecklistPageInput`, see that file) rather than the full `pages`
 * Prisma model specifically so this module can call them without a real,
 * persisted `pages` row — see `crawl.ts`'s header for why no such row
 * exists for a free snapshot.
 */
import { runTechnicalChecklist, runContentChecklist, type ChecklistCheck } from '../seo/technical-checklist.js';
import type { FreeSnapshotCrawlResult, FreeSnapshotPage } from './crawl.js';

export interface FreeSnapshotPageAnalysis {
  url: string;
  isHomepage: boolean;
  technicalScore: number;
  checks: ChecklistCheck[];
}

export interface FreeSnapshotSeoResult {
  pagesAnalyzed: number;
  averageTechnicalScore: number;
  contentScore: number;
  pages: FreeSnapshotPageAnalysis[];
  /** Every issue detected across the sample (crawl-time issues plus the
   * two additional checklist checks below), flattened for the report's gap
   * aggregation — see `report.ts`. */
  issues: Array<{ issueType: string; severity: string; pageUrl: string }>;
}

function toTechnicalChecklistInput(page: FreeSnapshotPage) {
  return {
    url: page.url,
    schema_types: page.schemaTypes,
    page_issues: page.issues.map((i) => ({ issue_type: i.issue_type, severity: i.severity, detail: i.detail })),
  };
}

export function analyzeFreeSnapshotSeo(crawl: FreeSnapshotCrawlResult): FreeSnapshotSeoResult {
  const pages = crawl.pages.map((page) => {
    const { score, findings, newIssues } = runTechnicalChecklist(toTechnicalChecklistInput(page), page.isHomepage);
    return { page, score, findings, newIssues };
  });

  const analyzed: FreeSnapshotPageAnalysis[] = pages.map(({ page, score, findings }) => ({
    url: page.url,
    isHomepage: page.isHomepage,
    technicalScore: score,
    checks: findings.checks,
  }));

  const averageTechnicalScore =
    analyzed.length === 0 ? 0 : Math.round(analyzed.reduce((sum, p) => sum + p.technicalScore, 0) / analyzed.length);

  const content = runContentChecklist(crawl.pages.map((p) => ({ word_count: p.wordCount, schema_types: p.schemaTypes })));

  const issues: FreeSnapshotSeoResult['issues'] = [];
  for (const { page, newIssues } of pages) {
    for (const issue of page.issues) {
      issues.push({ issueType: issue.issue_type, severity: issue.severity, pageUrl: page.url });
    }
    for (const issue of newIssues) {
      issues.push({ issueType: issue.issue_type, severity: issue.severity, pageUrl: page.url });
    }
  }

  return {
    pagesAnalyzed: crawl.pages.length,
    averageTechnicalScore,
    contentScore: content.score,
    pages: analyzed,
    issues,
  };
}
