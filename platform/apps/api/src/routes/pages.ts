import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type issue_severity } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import type { AppEnv } from '../types/context.js';
import type { page_issues, pages } from '@bebest/database';

const pagesRoute = new Hono<AppEnv>();

function serializePage(page: pages & { page_issues: page_issues[] }) {
  return {
    id: page.id,
    crawlJobId: page.crawl_job_id,
    url: page.url,
    title: page.title,
    metaDescription: page.meta_description,
    h1: page.h1,
    canonicalUrl: page.canonical_url,
    statusCode: page.status_code,
    wordCount: page.word_count,
    loadMs: page.load_ms,
    internalLinks: page.internal_links,
    externalLinks: page.external_links,
    // Computed rather than a stored column — see schema.prisma's comment on
    // `pages.schema_types` for why a denormalized boolean isn't kept
    // alongside the array it would just be duplicating.
    hasSchemaMarkup: page.schema_types.length > 0,
    schemaTypes: page.schema_types,
    crawledAt: page.crawled_at,
    issues: page.page_issues.map((issue) => ({
      id: issue.id,
      issueType: issue.issue_type,
      severity: issue.severity,
      detail: issue.detail,
    })),
  };
}

const listQuerySchema = z.object({
  severity: z.enum(['low', 'medium', 'high']).optional(),
  crawlJobId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── GET /brands/me/pages — paginated, filterable by issue severity ─────────
// Matches docs/epics/03-website-intelligence.md's literal route shape
// (`GET /brands/:id/pages`) except for "the" brand being resolved from the
// org rather than a brandId in the URL — same established deviation as
// routes/crawl.ts, see that file's comment.
//
// Defaults to the brand's MOST RECENT crawl job (current site state) rather
// than pages from every historical crawl ever run — re-crawls preserve
// history in the database (docs/epics/03-website-intelligence.md's
// end-to-end flow step 5) but a plain "show me my pages" call should show
// what's true now, not an ever-growing union of every past crawl. Pass
// `crawlJobId` explicitly to inspect an older crawl.
pagesRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission('view_intelligence'), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  }
  const { severity, crawlJobId, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const result = await withOrgContext(org.organizationId, async (tx) => {
    let targetJobId = crawlJobId;
    if (targetJobId) {
      const job = await tx.crawl_jobs.findFirst({
        where: { id: targetJobId, brand_id: brand.id, organization_id: org.organizationId },
      });
      if (!job) return null;
    } else {
      const latestJob = await tx.crawl_jobs.findFirst({
        where: { brand_id: brand.id, organization_id: org.organizationId },
        orderBy: { created_at: 'desc' },
      });
      if (!latestJob) return { total: 0, rows: [] as Array<pages & { page_issues: page_issues[] }> };
      targetJobId = latestJob.id;
    }

    const where = {
      organization_id: org.organizationId,
      brand_id: brand.id,
      crawl_job_id: targetJobId,
      deleted_at: null,
      ...(severity ? { page_issues: { some: { severity: severity as issue_severity } } } : {}),
    };

    const [total, rows] = await Promise.all([
      tx.pages.count({ where }),
      tx.pages.findMany({
        where,
        include: { page_issues: true },
        orderBy: { url: 'asc' },
        skip: offset,
        take: limit,
      }),
    ]);
    return { total, rows };
  });

  if (result === null) {
    return c.json({ error: 'Crawl job not found for this brand' }, 404);
  }

  return c.json({
    pages: result.rows.map(serializePage),
    pagination: { total: result.total, limit, offset },
  });
});

export default pagesRoute;
