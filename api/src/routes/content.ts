import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { db } from '../lib/db.js'
import { analyzeContent, getContentGaps, getContentImprovements } from '../lib/content-intelligence.js'

const content = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// GET /api/orgs/:slug/brands/:brandId/content
content.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Number(c.req.query('page') ?? 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit

  const [total, pages] = await Promise.all([
    db.pages.count({ where: { brand_id: brandId } }),
    db.pages.findMany({
      where: { brand_id: brandId },
      include: { content_analyses: true },
      orderBy: { crawled_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data: pages })
})

// GET /api/orgs/:slug/brands/:brandId/content/gaps
content.get('/gaps', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const summary = await getContentGaps(brandId)
  return c.json(summary)
})

// GET /api/orgs/:slug/brands/:brandId/content/improvements
content.get('/improvements', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const improvements = await getContentImprovements(brandId)
  return c.json(improvements)
})

// GET /api/orgs/:slug/brands/:brandId/content/export
content.get('/export', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const analyses = await db.content_analyses.findMany({
    where: { brand_id: brandId },
    include: { pages: { select: { url: true } } },
  }) as unknown as Array<Record<string, unknown> & { pages: { url: string } | null }>

  const format = c.req.query('format') ?? 'csv'

  if (format === 'json') {
    c.header('Content-Type', 'application/json')
    c.header('Content-Disposition', `attachment; filename="content-analyses-${brandId}.json"`)
    return c.json(analyses)
  }

  // Default: CSV
  const rows = analyses.map(a => [
    a.page_id,
    a.pages?.url ?? '',
    a.word_count ?? 0,
    a.ai_readiness_score ?? 0,
    a.thin_content_flag ? 'true' : 'false',
    a.topic_coverage_score ?? 0,
    a.structured_data_present ? 'true' : 'false',
    Array.isArray(a.gap_types) ? (a.gap_types as string[]).join('|') : '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

  const header = 'page_id,url,word_count,ai_readiness_score,thin_content_flag,topic_coverage_score,structured_data_present,gap_types'
  const csv = [header, ...rows].join('\n')

  c.header('Content-Disposition', `attachment; filename="content-analyses-${brandId}.csv"`)
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=UTF-8' })
})

// POST /api/orgs/:slug/brands/:brandId/content/analyze-all
content.post('/analyze-all', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const pages = await db.pages.findMany({
    where: { brand_id: brandId },
    select: { id: true },
  })

  for (const p of pages) {
    setImmediate(() => analyzeContent(p.id, brandId).catch(() => void 0))
  }

  return c.json({ queued: pages.length }, 202)
})

// GET /api/orgs/:slug/brands/:brandId/content/:pageId
content.get('/:pageId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const pageId = c.req.param('pageId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = await db.pages.findFirst({
    where: { id: pageId, brand_id: brandId },
    include: { content_analyses: true },
  })
  if (!page) return c.json({ error: 'Page not found' }, 404)

  return c.json(page)
})

// POST /api/orgs/:slug/brands/:brandId/content/:pageId/analyze
content.post('/:pageId/analyze', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const pageId = c.req.param('pageId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  setImmediate(() => analyzeContent(pageId, brandId).catch(() => void 0))

  return c.json({ queued: true }, 202)
})

export default content
