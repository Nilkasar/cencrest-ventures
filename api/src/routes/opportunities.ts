import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { recalculateOpportunities } from '../lib/opportunity-engine.js'

const opportunities = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

const VALID_SORT = ['unified_score', 'seo_gap_score', 'geo_gap_score', 'volume'] as const
type SortField = (typeof VALID_SORT)[number]

// GET /
opportunities.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const tier = c.req.query('tier') as 'P1' | 'P2' | 'P3' | undefined
  const sortParam = c.req.query('sort') ?? 'unified_score'
  const sort: SortField = (VALID_SORT as readonly string[]).includes(sortParam)
    ? (sortParam as SortField)
    : 'unified_score'

  const where = {
    brand_id: brandId,
    ...(tier ? { priority_tier: tier } : {}),
  }

  const [total, data] = await Promise.all([
    db.opportunities.count({ where }),
    db.opportunities.findMany({
      where,
      orderBy: { [sort]: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// GET /summary
opportunities.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const [p1, p2, p3, all] = await Promise.all([
    db.opportunities.count({ where: { brand_id: brandId, priority_tier: 'P1' } }),
    db.opportunities.count({ where: { brand_id: brandId, priority_tier: 'P2' } }),
    db.opportunities.count({ where: { brand_id: brandId, priority_tier: 'P3' } }),
    db.opportunities.findMany({ where: { brand_id: brandId }, select: { unified_score: true } }),
  ])

  const totalOpportunities = p1 + p2 + p3
  const avgUnifiedScore = totalOpportunities > 0
    ? all.reduce((sum, o) => {
        const v = typeof o.unified_score === 'object'
          ? (o.unified_score as { toNumber(): number }).toNumber()
          : Number(o.unified_score)
        return sum + v
      }, 0) / totalOpportunities
    : 0

  return c.json({ P1: p1, P2: p2, P3: p3, avgUnifiedScore, totalOpportunities })
})

// POST /recalculate
opportunities.post('/recalculate', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  setImmediate(() => {
    recalculateOpportunities(brandId).catch((err) => {
      console.error('recalculateOpportunities failed:', err)
    })
  })

  return c.json({ recalculated: 0 }, 202)
})

// GET /:opportunityId
opportunities.get('/:opportunityId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const opportunityId = c.req.param('opportunityId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const opportunity = await db.opportunities.findFirst({
    where: { id: opportunityId, brand_id: brandId },
  })

  if (!opportunity) return c.json({ error: 'Opportunity not found' }, 404)

  return c.json(opportunity)
})

export default opportunities
