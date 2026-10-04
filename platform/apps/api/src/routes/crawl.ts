import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { startCrawlForBrand } from '../lib/crawler/start-crawl.js';
import type { AppEnv } from '../types/context.js';
import type { crawl_jobs } from '@bebest/database';

const crawlRoute = new Hono<AppEnv>();

// The `crawl_job` background handler and the start logic live in
// `lib/crawler/start-crawl.ts` (Epic 22 Phase 2 — shared with onboarding
// completion, which starts the first crawl through the same function).

export function serializeCrawlJob(job: crawl_jobs) {
  return {
    id: job.id,
    brandId: job.brand_id,
    rootUrl: job.root_url,
    status: job.status,
    pagesCrawled: job.pages_crawled,
    pagesFound: job.pages_found,
    pagesFailed: job.pages_failed,
    error: job.error,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

// ── POST /brands/me/crawl — trigger a crawl for the org's brand ────────────
// docs/epics/03-website-intelligence.md's route is literally
// `POST /brands/:id/crawl`; this codebase's established convention (Epic 2
// — see app.ts's comment above the /api/brands/me/* mounts) resolves "the"
// brand from the org via brand-context.ts instead of a brandId in the URL,
// same as every other brand-child resource. Followed here for consistency
// rather than the spec's literal path — see
// docs/epics/03-website-intelligence-backend.md.
crawlRoute.post('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission('create_brand_profile'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');

  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const result = await startCrawlForBrand({ organizationId: org.organizationId, brand, userId: user.id });

  if (result.status === 'skipped' && result.reason === 'no_website_url') {
    return c.json(
      {
        error: 'no_website_url',
        message: 'This brand has no website URL yet. Set one first via PATCH /api/brands/me.',
      },
      422,
    );
  }
  if (result.status === 'skipped') {
    return c.json(
      {
        error: 'crawl_already_in_progress',
        message: 'A crawl is already queued or running for this brand.',
        crawlJobId: result.job.id,
      },
      409,
    );
  }

  await writeManualAuditEvent(c, { action: 'crawl_job.created', entityType: 'crawl_job', entityId: result.job.id });

  return c.json(serializeCrawlJob(result.job), 202);
});

export default crawlRoute;
