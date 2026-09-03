/**
 * Epic 14 (Measurement & Learning Loop) — the SEO half of re-measurement's
 * "after" score. Calls Epic 4's REAL scoring functions directly
 * (`runTechnicalChecklist`/`runContentChecklist`, `lib/seo/technical-
 * checklist.ts`) — never a reimplementation of the checklist logic itself
 * (this epic's own non-negotiable). Structured the same way `routes/
 * seo.ts`'s `POST /brands/me/seo/analyze` orchestrates those same two
 * functions (most-recent `crawl_jobs` row -> its `pages`+`page_issues` ->
 * one `runTechnicalChecklist` call per page + one `runContentChecklist`
 * call over all of them -> persist new `seo_analyses`/`page_issues` rows),
 * but callable directly from a background job with no HTTP request behind
 * it, and returning the aggregated brand-level component this epic's
 * `ScoreSnapshot` needs (via `current-score-snapshot.ts`'s shared
 * `aggregateSeoComponent`) rather than the route's own per-page response
 * shape.
 *
 * Deliberately makes NO new network call and triggers NO new crawl — Epic
 * 3's crawler already enforces its own SSRF/rate/size limits at CRAWL time;
 * re-scoring already-crawled, already-stored pages on the 4-week cycle is
 * safe, cheap, and requires no new permission surface. Re-crawling the
 * customer's live site automatically on this same cycle is a materially
 * bigger, separate scope decision this epic's spec does not require (see
 * this epic's backend doc's "not done" list) — a brand with no crawl data
 * yet, or crawl data that has since gone stale, simply yields `seo: null`
 * for the after-score, exactly the same as it would for `before_score`.
 *
 * `normalizeUrlForComparison` is a small, deliberate duplicate of `routes/
 * seo.ts`'s own private helper of the same name (4 lines, not exported by
 * that file) — copying this tiny, already-tested comparison helper is a
 * far smaller footprint than exporting internals from a route file this
 * epic does not otherwise touch, and it duplicates NONE of Epic 4's actual
 * scoring logic (only this URL-matching convenience).
 */
import { withOrgContext, type Prisma } from '@bebest/database';
import { runContentChecklist, runTechnicalChecklist } from '../seo/technical-checklist.js';
import { aggregateSeoComponent } from './current-score-snapshot.js';
import type { SeoScoreComponent } from './scoring.js';

function normalizeUrlForComparison(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export async function reanalyzeSeoForBrand(organizationId: string, brandId: string): Promise<SeoScoreComponent | null> {
  const result = await withOrgContext(organizationId, async (tx) => {
    const job = await tx.crawl_jobs.findFirst({
      where: { brand_id: brandId, organization_id: organizationId },
      orderBy: { created_at: 'desc' },
    });
    if (!job) return null;

    const pagesRows = await tx.pages.findMany({
      where: { organization_id: organizationId, brand_id: brandId, crawl_job_id: job.id, deleted_at: null },
      include: { page_issues: true },
    });
    if (pagesRows.length === 0) return null;

    const rootUrlNormalized = normalizeUrlForComparison(job.root_url);
    const technicalScores: number[] = [];
    const measuredAtCandidates: Date[] = [];

    // Sequential, not Promise.all — same shared-`tx` constraint `routes/
    // seo.ts`'s own /analyze handler documents (Prisma's TransactionClient
    // does not support concurrent queries on one transaction).
    for (const page of pagesRows) {
      const isHomepage = normalizeUrlForComparison(page.url) === rootUrlNormalized;
      const { score, findings, newIssues } = runTechnicalChecklist(page, isHomepage);

      if (newIssues.length > 0) {
        await tx.page_issues.createMany({
          data: newIssues.map((issue) => ({ organization_id: organizationId, brand_id: brandId, page_id: page.id, ...issue })),
        });
      }

      const analysis = await tx.seo_analyses.create({
        data: {
          organization_id: organizationId,
          brand_id: brandId,
          page_id: page.id,
          analysis_type: 'technical',
          score,
          findings: findings as unknown as Prisma.InputJsonValue,
        },
      });
      technicalScores.push(score);
      measuredAtCandidates.push(analysis.analyzed_at);
    }

    const content = runContentChecklist(pagesRows);
    const contentAnalysis = await tx.seo_analyses.create({
      data: {
        organization_id: organizationId,
        brand_id: brandId,
        page_id: null,
        analysis_type: 'content',
        score: content.score,
        findings: content.findings as unknown as Prisma.InputJsonValue,
      },
    });
    measuredAtCandidates.push(contentAnalysis.analyzed_at);

    return { technicalScores, contentScore: content.score, measuredAtCandidates, pagesAnalyzed: pagesRows.length };
  });

  if (!result) return null;

  return aggregateSeoComponent(result);
}
