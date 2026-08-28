import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const keywords = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

const keywordSchema = z.object({
  keyword: z.string().min(1).max(500),
  volume: z.number().int().nonnegative().optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  cpc: z.number().nonnegative().optional(),
  intent: z.enum(['informational', 'navigational', 'commercial', 'transactional']).optional(),
})

// POST /api/orgs/:slug/brands/:brandId/keywords — add keyword(s)
keywords.post('/', requireAuth, requireOrgRole('member'),
  zValidator('json', z.union([keywordSchema, z.array(keywordSchema)])),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')
    const items = Array.isArray(body) ? body : [body]

    const created = await Promise.all(
      items.map((item) =>
        db.keywords.upsert({
          where: { brand_id_keyword: { brand_id: brandId, keyword: item.keyword } },
          create: { brand_id: brandId, ...item },
          update: { volume: item.volume, difficulty: item.difficulty, cpc: item.cpc, intent: item.intent, updated_at: new Date() },
        })
      )
    )

    return c.json(created, 201)
  }
)

// GET /api/orgs/:slug/brands/:brandId/keywords — list keywords with latest rankings
keywords.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Number(c.req.query('page') ?? 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const intent = c.req.query('intent') as string | undefined

  const where = {
    brand_id: brandId,
    ...(intent ? { intent: intent as never } : {}),
  }

  const [total, rows] = await Promise.all([
    db.keywords.count({ where }),
    db.keywords.findMany({
      where,
      orderBy: [{ volume: 'desc' }, { keyword: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        brand_keyword_rankings: {
          orderBy: { date: 'desc' },
          take: 1,
        },
      },
    }),
  ])

  const data = rows.map(({ brand_keyword_rankings, ...kw }) => ({
    ...kw,
    latestRanking: brand_keyword_rankings[0] ?? null,
  }))

  return c.json({ total, page, limit, data })
})

// GET /api/orgs/:slug/brands/:brandId/keywords/gaps — keywords with no top-50 ranking
keywords.get('/gaps', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Number(c.req.query('page') ?? 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)

  // Keywords where no ranking exists in top 50 on the most recent date
  const allKeywords = await db.keywords.findMany({
    where: { brand_id: brandId },
    include: {
      brand_keyword_rankings: {
        where: { position: { lte: 50 } },
        orderBy: { date: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ volume: 'desc' }, { keyword: 'asc' }],
  })

  const gaps = allKeywords.filter((kw) => kw.brand_keyword_rankings.length === 0)
  const total = gaps.length
  const data = gaps
    .slice((page - 1) * limit, page * limit)
    .map(({ brand_keyword_rankings, ...kw }) => kw)

  return c.json({ total, page, limit, data })
})

// GET /api/orgs/:slug/brands/:brandId/keywords/clusters — keyword clusters
keywords.get('/clusters', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const clusters = await db.keyword_clusters.findMany({
    where: { brand_id: brandId },
    orderBy: { cluster_name: 'asc' },
  })

  return c.json(clusters)
})

// POST /api/orgs/:slug/brands/:brandId/keywords/clusters — create cluster
keywords.post('/clusters', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({
    cluster_name: z.string().min(1).max(255),
    pillar_topic: z.string().max(255).optional(),
    keyword_ids: z.array(z.string().uuid()),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const cluster = await db.keyword_clusters.create({
      data: { brand_id: brandId, ...body },
    })

    return c.json(cluster, 201)
  }
)

// POST /api/orgs/:slug/brands/:brandId/keywords/import — bulk CSV import
keywords.post('/import', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.includes('text/csv') && !contentType.includes('text/plain')) {
    return c.json({ error: 'Expected text/csv body' }, 415)
  }

  const text = await c.req.text()
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  if (lines.length === 0) return c.json({ imported: 0, skipped: 0 })

  // Detect header row
  const firstLine = lines[0].toLowerCase()
  const hasHeader = firstLine.startsWith('keyword')
  const dataLines = hasHeader ? lines.slice(1) : lines

  let imported = 0
  let skipped = 0

  for (const line of dataLines) {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const keyword = cols[0]
    if (!keyword) { skipped++; continue }

    const volume = cols[1] ? parseInt(cols[1], 10) : undefined
    const difficulty = cols[2] ? parseInt(cols[2], 10) : undefined
    const intentRaw = cols[3]?.toLowerCase()
    const intent = ['informational', 'navigational', 'commercial', 'transactional'].includes(intentRaw)
      ? intentRaw as never
      : undefined

    try {
      await db.keywords.upsert({
        where: { brand_id_keyword: { brand_id: brandId, keyword } },
        create: {
          brand_id: brandId, keyword,
          volume: isNaN(volume!) ? undefined : volume,
          difficulty: isNaN(difficulty!) ? undefined : difficulty,
          intent,
          source: 'csv_import',
        },
        update: {
          volume: isNaN(volume!) ? undefined : volume,
          difficulty: isNaN(difficulty!) ? undefined : difficulty,
          intent,
          updated_at: new Date(),
        },
      })
      imported++
    } catch { skipped++ }
  }

  return c.json({ imported, skipped })
})

// GET /api/orgs/:slug/brands/:brandId/keywords/competitor-overlap — keywords competitor ranks for but brand doesn't
keywords.get('/competitor-overlap', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Returns brand keywords where brand has no top-20 ranking — proxy for competitor advantage
  const allKeywords = await db.keywords.findMany({
    where: { brand_id: brandId },
    include: {
      brand_keyword_rankings: {
        where: { position: { lte: 20 } },
        orderBy: { date: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ volume: 'desc' }],
    take: 200,
  })

  const overlap = allKeywords
    .filter((kw) => kw.brand_keyword_rankings.length === 0)
    .map(({ brand_keyword_rankings, ...kw }) => kw)

  return c.json({ total: overlap.length, data: overlap })
})

export default keywords
