import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { validateDomain } from '../lib/meta-fetch.js'
import { runCrawl } from '../lib/crawler.js'

const crawl = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// POST /api/orgs/:slug/brands/:brandId/crawl — trigger crawl job
crawl.post('/', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)
  if (!brand.website_url) return c.json({ error: 'Brand has no website URL' }, 422)

  const domain = validateDomain(brand.website_url)
  if (!domain) return c.json({ error: 'Invalid or private domain' }, 422)

  const running = await db.crawl_jobs.findFirst({
    where: { brand_id: brandId, status: { in: ['pending', 'running'] } },
  })
  if (running) return c.json({ error: 'Crawl already in progress', jobId: running.id }, 409)

  const job = await db.crawl_jobs.create({
    data: { brand_id: brandId, status: 'pending' },
  })

  const startUrl = brand.website_url.startsWith('http') ? brand.website_url : `https://${domain}`

  // Fire-and-forget — does not block response
  setImmediate(() => runCrawl(job.id, brandId, startUrl))

  return c.json(job, 202)
})

// GET /api/orgs/:slug/brands/:brandId/crawl/status — latest job status
crawl.get('/status', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const job = await db.crawl_jobs.findFirst({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
  })

  if (!job) return c.json({ status: 'never_crawled' })
  return c.json(job)
})

// GET /api/orgs/:slug/brands/:brandId/pages — paginated crawled pages
crawl.get('/pages', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Number(c.req.query('page') ?? 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const skip = (page - 1) * limit

  const [total, pages] = await Promise.all([
    db.pages.count({ where: { brand_id: brandId } }),
    db.pages.findMany({
      where: { brand_id: brandId },
      orderBy: { crawled_at: 'desc' },
      skip,
      take: limit,
      include: { _count: { select: { page_issues: true } } },
    }),
  ])

  return c.json({ total, page, limit, data: pages })
})

// GET /api/orgs/:slug/brands/:brandId/pages/:pageId — single page detail
crawl.get('/pages/:pageId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const pageId = c.req.param('pageId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const pg = await db.pages.findFirst({
    where: { id: pageId, brand_id: brandId },
    include: { page_issues: true },
  })
  if (!pg) return c.json({ error: 'Page not found' }, 404)

  return c.json(pg)
})

// GET /api/orgs/:slug/brands/:brandId/site-health — aggregated SEO score
crawl.get('/site-health', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const [pageCount, issuesByType] = await Promise.all([
    db.pages.count({ where: { brand_id: brandId } }),
    db.page_issues.groupBy({
      by: ['severity'],
      where: { page: { brand_id: brandId } },
      _count: { severity: true },
    }),
  ])

  const counts = { critical: 0, warning: 0, info: 0 }
  for (const row of issuesByType) counts[row.severity] = row._count.severity

  // Score: start at 100, deduct per issue
  const score = Math.max(0, 100 - counts.critical * 5 - counts.warning * 2 - counts.info * 0.5)

  const latestJob = await db.crawl_jobs.findFirst({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
  })

  return c.json({ pageCount, issues: counts, score: Math.round(score), lastCrawledAt: latestJob?.completed_at ?? null })
})

// GET /api/orgs/:slug/brands/:brandId/issues — all page issues filterable by severity
crawl.get('/issues', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const severity = c.req.query('severity') as 'critical' | 'warning' | 'info' | undefined
  const page = Number(c.req.query('page') ?? 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const skip = (page - 1) * limit

  const where = {
    page: { brand_id: brandId },
    ...(severity ? { severity } : {}),
  }

  const [total, issues] = await Promise.all([
    db.page_issues.count({ where }),
    db.page_issues.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
      include: { page: { select: { url: true } } },
    }),
  ])

  return c.json({ total, page, limit, data: issues })
})

export default crawl
