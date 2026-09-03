import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext, type crawl_status } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
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

const listQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Epic 19 (Production Hardening), item 5 — Epic 3's own completion doc
 * flagged this exact gap: no server-side "list crawl jobs for this brand"
 * route, so `apps/web`'s `data/website/client.ts` worked around it with a
 * `localStorage`-tracked pointer list of job ids the browser has seen (see
 * that file's header comment for the full account) — losing the *history
 * view* on a cleared browser/different device, never correctness (every
 * field still came from a real `GET /crawl-jobs/:id`). This closes that
 * gap: a real, paginated, tenant-scoped, newest-first list, matching
 * `GET /brands/me/pages`'s exact response shape (`{ <plural>, pagination:
 * { total, limit, offset } }`) — the established list-endpoint convention
 * in this codebase (see that route's own comment) — server-side capped at
 * 100/page regardless of what a caller requests (Epic 19 item 6's
 * pagination audit).
 */
const crawlJobsListRoute = new Hono<AppEnv>();

crawlJobsListRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission('view_intelligence'), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  }
  const { status, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    ...(status ? { status: status as crawl_status } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.crawl_jobs.count({ where }),
      tx.crawl_jobs.findMany({ where, orderBy: { created_at: 'desc' }, skip: offset, take: limit }),
    ]),
  );

  return c.json({
    crawlJobs: rows.map(serializeCrawlJob),
    pagination: { total, limit, offset },
  });
});

export { crawlJobsListRoute };

// ── GET /crawl-jobs/:id — status/progress ───────────────────────────────────
// Matches docs/epics/03-website-intelligence.md's literal route. Scoped by
// organization_id via withOrgContext (RLS) AND an explicit WHERE clause
// (belt + suspenders, same pattern every other route in this codebase
// uses) — a job id from another org 404s, it never leaks a 403 that would
// confirm the id exists.
crawlJobsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission('view_intelligence'), async (c) => {
  const org = c.get('org');
  const id = c.req.param('id');

  const job = await withOrgContext(org.organizationId, (tx) =>
    tx.crawl_jobs.findFirst({ where: { id, organization_id: org.organizationId } }),
  );
  if (!job) return c.json({ error: 'Crawl job not found' }, 404);

  return c.json(serializeCrawlJob(job));
});

export default crawlJobsRoute;
