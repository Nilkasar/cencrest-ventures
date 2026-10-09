import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { scheduleCrawlJob } from '../lib/crawler/crawl-job.js';
import type { AppEnv } from '../types/context.js';
import type { crawl_jobs } from '@bebest/database';

const crawlRoute = new Hono<AppEnv>();

function serializeCrawlJob(job: crawl_jobs) {
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

  if (!brand.website_url) {
    return c.json(
      {
        error: 'no_website_url',
        message: 'This brand has no website URL yet. Set one first via PATCH /api/brands/me.',
      },
      422,
    );
  }

  const existingActive = await withOrgContext(org.organizationId, (tx) =>
    tx.crawl_jobs.findFirst({
      where: { brand_id: brand.id, organization_id: org.organizationId, status: { in: ['queued', 'running'] } },
    }),
  );
  if (existingActive) {
    return c.json(
      {
        error: 'crawl_already_in_progress',
        message: 'A crawl is already queued or running for this brand.',
        crawlJobId: existingActive.id,
      },
      409,
    );
  }

  // The crawl_jobs row is created HERE, synchronously, before the
  // background job is even scheduled — let alone before any HTTP request
  // is made. This is the literal invariant
  // docs/epics/03-website-intelligence.md's end-to-end flow step 1 checks:
  // "confirm a crawl_jobs row is created in queued status before any HTTP
  // request is made."
  const job = await withOrgContext(org.organizationId, (tx) =>
    tx.crawl_jobs.create({
      data: {
        organization_id: org.organizationId,
        brand_id: brand.id,
        root_url: brand.website_url as string,
        status: 'queued',
        created_by: user.id,
      },
    }),
  );

  await writeManualAuditEvent(c, { action: 'crawl_job.created', entityType: 'crawl_job', entityId: job.id });

  // Awaited, not fire-and-forget: with `JOB_QUEUE_DATABASE_URL` set this
  // writes a durable pg-boss row that the separate worker process picks up
  // (`lib/crawler/crawl-job.ts`), and a serverless function that returned
  // its 202 before that INSERT landed would lose the crawl entirely. With no
  // queue database configured it resolves immediately and the handler still
  // fires in-process, exactly as before.
  await scheduleCrawlJob({
    jobId: job.id,
    organizationId: org.organizationId,
    brandId: brand.id,
    rootUrl: job.root_url,
  });

  return c.json(serializeCrawlJob(job), 202);
});

export default crawlRoute;
