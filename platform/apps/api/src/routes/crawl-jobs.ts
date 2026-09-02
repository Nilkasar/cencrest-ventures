import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import type { AppEnv } from '../types/context.js';
import type { crawl_jobs } from '@bebest/database';

const crawlJobsRoute = new Hono<AppEnv>();

function serializeCrawlJob(job: crawl_jobs) {
  const progressPct = job.pages_found > 0 ? Math.min(100, Math.round((job.pages_crawled / job.pages_found) * 100)) : 0;
  return {
    id: job.id,
    brandId: job.brand_id,
    rootUrl: job.root_url,
    status: job.status,
    pagesCrawled: job.pages_crawled,
    pagesFound: job.pages_found,
    pagesFailed: job.pages_failed,
    progressPct: job.status === 'completed' || job.status === 'failed' ? 100 : progressPct,
    error: job.error,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

// ── GET /crawl-jobs/:id — status/progress ───────────────────────────────────
// Matches docs/epics/03-website-intelligence.md's literal route. Scoped by
// organization_id via withOrgContext (RLS) AND an explicit WHERE clause
// (belt + suspenders, same pattern every other route in this codebase
// uses) — a job id from another org 404s, it never leaks a 403 that would
// confirm the id exists.
crawlJobsRoute.get('/:id', requireAuth, requireOrgFromToken('viewer'), requirePermission('view_intelligence'), async (c) => {
  const org = c.get('org');
  const id = c.req.param('id');

  const job = await withOrgContext(org.organizationId, (tx) =>
    tx.crawl_jobs.findFirst({ where: { id, organization_id: org.organizationId } }),
  );
  if (!job) return c.json({ error: 'Crawl job not found' }, 404);

  return c.json(serializeCrawlJob(job));
});

export default crawlJobsRoute;
