import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const journeys = new Hono<AppEnv>()

const STAGES = ['awareness', 'consideration', 'evaluation', 'purchase'] as const
const INTENTS = ['informational', 'navigational', 'commercial', 'transactional'] as const

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// Generates representative queries per stage from brand context (no external AI call — deterministic templates)
function generateQueriesForBrand(
  brandName: string,
  industry: string | null,
  productName: string | null
): Array<{ stage: typeof STAGES[number]; query: string; intent_type: typeof INTENTS[number] }> {
  const product = productName ?? brandName
  const cat = industry ?? 'product'

  return [
    // Awareness
    { stage: 'awareness', query: `what is ${cat}`, intent_type: 'informational' },
    { stage: 'awareness', query: `how does ${cat} work`, intent_type: 'informational' },
    { stage: 'awareness', query: `${cat} explained`, intent_type: 'informational' },
    { stage: 'awareness', query: `benefits of ${cat}`, intent_type: 'informational' },
    { stage: 'awareness', query: `why use ${cat}`, intent_type: 'informational' },
    { stage: 'awareness', query: `${cat} for beginners`, intent_type: 'informational' },
    { stage: 'awareness', query: `introduction to ${cat}`, intent_type: 'informational' },
    { stage: 'awareness', query: `${cat} overview`, intent_type: 'informational' },
    { stage: 'awareness', query: `what problems does ${cat} solve`, intent_type: 'informational' },
    { stage: 'awareness', query: `${cat} use cases`, intent_type: 'informational' },
    // Consideration
    { stage: 'consideration', query: `best ${cat} software`, intent_type: 'commercial' },
    { stage: 'consideration', query: `top ${cat} tools`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${cat} comparison`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${product} alternatives`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${product} vs competitors`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${cat} features to look for`, intent_type: 'informational' },
    { stage: 'consideration', query: `how to choose ${cat}`, intent_type: 'informational' },
    { stage: 'consideration', query: `${cat} checklist`, intent_type: 'informational' },
    { stage: 'consideration', query: `${product} review`, intent_type: 'commercial' },
    { stage: 'consideration', query: `is ${product} worth it`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${product} pros and cons`, intent_type: 'commercial' },
    { stage: 'consideration', query: `${cat} for small business`, intent_type: 'commercial' },
    // Evaluation
    { stage: 'evaluation', query: `${product} pricing`, intent_type: 'commercial' },
    { stage: 'evaluation', query: `${product} demo`, intent_type: 'commercial' },
    { stage: 'evaluation', query: `${product} free trial`, intent_type: 'transactional' },
    { stage: 'evaluation', query: `${product} case studies`, intent_type: 'commercial' },
    { stage: 'evaluation', query: `${product} customer reviews`, intent_type: 'commercial' },
    { stage: 'evaluation', query: `${product} integrations`, intent_type: 'commercial' },
    { stage: 'evaluation', query: `${product} support`, intent_type: 'informational' },
    { stage: 'evaluation', query: `${product} security`, intent_type: 'informational' },
    { stage: 'evaluation', query: `${product} api`, intent_type: 'informational' },
    { stage: 'evaluation', query: `${product} implementation`, intent_type: 'informational' },
    { stage: 'evaluation', query: `how long to implement ${product}`, intent_type: 'informational' },
    { stage: 'evaluation', query: `${product} roi`, intent_type: 'commercial' },
    // Purchase
    { stage: 'purchase', query: `buy ${product}`, intent_type: 'transactional' },
    { stage: 'purchase', query: `${product} sign up`, intent_type: 'transactional' },
    { stage: 'purchase', query: `${product} get started`, intent_type: 'transactional' },
    { stage: 'purchase', query: `${product} contact sales`, intent_type: 'transactional' },
    { stage: 'purchase', query: `${product} enterprise plan`, intent_type: 'transactional' },
    { stage: 'purchase', query: `${product} onboarding`, intent_type: 'informational' },
    { stage: 'purchase', query: `${product} setup guide`, intent_type: 'informational' },
    { stage: 'purchase', query: `${product} getting started`, intent_type: 'informational' },
  ]
}

// POST /api/orgs/:slug/brands/:brandId/journeys/generate
journeys.post('/generate', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({ product_id: z.string().uuid().optional() })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const { product_id } = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    let productName: string | null = null
    if (product_id) {
      const product = await db.products.findFirst({ where: { id: product_id, brand_id: brandId } })
      if (!product) return c.json({ error: 'Product not found' }, 404)
      productName = product.name
    }

    const queries = generateQueriesForBrand(brand.name, brand.industry, productName)

    // Deduplicate against existing queries for this brand
    const existing = await db.buyer_journeys.findMany({
      where: { brand_id: brandId, deleted_at: null },
      select: { query: true },
    })
    const existingSet = new Set(existing.map((e) => e.query.toLowerCase()))
    const newQueries = queries.filter((q) => !existingSet.has(q.query.toLowerCase()))

    const created = await db.buyer_journeys.createMany({
      data: newQueries.map((q) => ({
        brand_id: brandId,
        product_id: product_id ?? null,
        stage: q.stage,
        query: q.query,
        intent_type: q.intent_type,
        generated_by: 'ai',
      })),
      skipDuplicates: true,
    })

    return c.json({ generated: created.count, skipped: queries.length - created.count }, 201)
  }
)

// GET /api/orgs/:slug/brands/:brandId/journeys
journeys.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const stage = c.req.query('stage') as typeof STAGES[number] | undefined

  const rows = await db.buyer_journeys.findMany({
    where: { brand_id: brandId, deleted_at: null, ...(stage ? { stage } : {}) },
    orderBy: [{ stage: 'asc' }, { created_at: 'asc' }],
  })

  // Group by stage
  const grouped = STAGES.reduce((acc, s) => {
    acc[s] = rows.filter((r) => r.stage === s)
    return acc
  }, {} as Record<string, typeof rows>)

  return c.json({ total: rows.length, stages: grouped })
})

// POST /api/orgs/:slug/brands/:brandId/journeys/queries
journeys.post('/queries', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({
    stage: z.enum(STAGES),
    query: z.string().min(1).max(1000),
    persona: z.string().max(255).optional(),
    intent_type: z.enum(INTENTS).optional(),
    product_id: z.string().uuid().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const row = await db.buyer_journeys.create({
      data: {
        brand_id: brandId,
        stage: body.stage,
        query: body.query,
        persona: body.persona ?? null,
        intent_type: body.intent_type ?? null,
        product_id: body.product_id ?? null,
        generated_by: 'user',
      },
    })

    return c.json(row, 201)
  }
)

// PATCH /api/orgs/:slug/brands/:brandId/journeys/queries/:queryId
journeys.patch('/queries/:queryId', requireAuth, requireOrgRole('member'),
  zValidator('json', z.object({
    query: z.string().min(1).max(1000).optional(),
    stage: z.enum(STAGES).optional(),
    persona: z.string().max(255).optional(),
    intent_type: z.enum(INTENTS).optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const queryId = c.req.param('queryId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const existing = await db.buyer_journeys.findFirst({
      where: { id: queryId, brand_id: brandId, deleted_at: null },
    })
    if (!existing) return c.json({ error: 'Query not found' }, 404)

    const updated = await db.buyer_journeys.update({
      where: { id: queryId },
      data: { ...body, updated_at: new Date() },
    })

    return c.json(updated)
  }
)

// DELETE /api/orgs/:slug/brands/:brandId/journeys/queries/:queryId
journeys.delete('/queries/:queryId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const queryId = c.req.param('queryId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const existing = await db.buyer_journeys.findFirst({
    where: { id: queryId, brand_id: brandId, deleted_at: null },
  })
  if (!existing) return c.json({ error: 'Query not found' }, 404)

  await db.buyer_journeys.update({
    where: { id: queryId },
    data: { deleted_at: new Date() },
  })

  return c.json({ success: true })
})

// GET /api/orgs/:slug/brands/:brandId/journeys/export
journeys.get('/export', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const format = c.req.query('format') === 'json' ? 'json' : 'csv'

  const rows = await db.buyer_journeys.findMany({
    where: { brand_id: brandId, deleted_at: null },
    orderBy: [{ stage: 'asc' }, { created_at: 'asc' }],
  })

  if (format === 'json') {
    c.header('Content-Disposition', `attachment; filename="journeys-${brandId}.json"`)
    c.header('Content-Type', 'application/json')
    return c.body(JSON.stringify(rows, null, 2))
  }

  const header = 'id,stage,query,intent_type,persona,generated_by,created_at'
  const lines = rows.map((r) =>
    [r.id, r.stage, `"${r.query.replace(/"/g, '""')}"`, r.intent_type ?? '', r.persona ?? '', r.generated_by, r.created_at.toISOString()].join(',')
  )

  c.header('Content-Disposition', `attachment; filename="journeys-${brandId}.csv"`)
  c.header('Content-Type', 'text/csv')
  return c.body([header, ...lines].join('\n'))
})

export default journeys
