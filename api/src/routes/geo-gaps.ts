import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const geoGaps = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

const VALID_SORT = ['business_impact_score', 'severity', 'created_at'] as const
type SortField = (typeof VALID_SORT)[number]

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

// GET / — list active gaps, paginated
geoGaps.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const gapType = c.req.query('gap_type') as string | undefined
  const severity = c.req.query('severity') as string | undefined
  const provider = c.req.query('provider') as string | undefined
  const sortParam = c.req.query('sort') ?? 'business_impact_score'
  const sort: SortField = (VALID_SORT as readonly string[]).includes(sortParam)
    ? (sortParam as SortField)
    : 'business_impact_score'

  const where = {
    brand_id: brandId,
    dismissed_at: null,
    ...(gapType ? { gap_type: gapType as 'no_mention' | 'low_sentiment' | 'no_citation' | 'competitor_only' } : {}),
    ...(severity ? { severity: severity as 'critical' | 'high' | 'medium' | 'low' } : {}),
    ...(provider ? { provider_name: provider } : {}),
  }

  const [total, rows] = await Promise.all([
    db.geo_gaps.count({ where }),
    db.geo_gaps.findMany({
      where,
      include: {
        buyer_journeys: { select: { query: true, stage: true, intent_type: true } },
      },
      orderBy: { [sort]: sort === 'business_impact_score' ? 'desc' : sort === 'severity' ? 'asc' : 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  // If sorting by severity, sort in memory using ordinal ranking
  let data = rows.map((g) => ({
    ...g,
    query: g.buyer_journeys.query,
    stage: g.buyer_journeys.stage,
    buyer_journeys: undefined,
  }))

  if (sort === 'severity') {
    data = data.sort(
      (a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0),
    )
  }

  return c.json({ total, page, limit, data })
})

// GET /summary — counts by gap_type and severity
geoGaps.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const baseWhere = { brand_id: brandId, dismissed_at: null }

  const [
    no_mention, low_sentiment, no_citation, competitor_only,
    critical, high, medium, low, total,
  ] = await Promise.all([
    db.geo_gaps.count({ where: { ...baseWhere, gap_type: 'no_mention' } }),
    db.geo_gaps.count({ where: { ...baseWhere, gap_type: 'low_sentiment' } }),
    db.geo_gaps.count({ where: { ...baseWhere, gap_type: 'no_citation' } }),
    db.geo_gaps.count({ where: { ...baseWhere, gap_type: 'competitor_only' } }),
    db.geo_gaps.count({ where: { ...baseWhere, severity: 'critical' } }),
    db.geo_gaps.count({ where: { ...baseWhere, severity: 'high' } }),
    db.geo_gaps.count({ where: { ...baseWhere, severity: 'medium' } }),
    db.geo_gaps.count({ where: { ...baseWhere, severity: 'low' } }),
    db.geo_gaps.count({ where: baseWhere }),
  ])

  return c.json({
    byType: { no_mention, low_sentiment, no_citation, competitor_only },
    bySeverity: { critical, high, medium, low },
    total,
  })
})

// GET /:gapId — gap detail
geoGaps.get('/:gapId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const gapId = c.req.param('gapId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const gap = await db.geo_gaps.findFirst({
    where: { id: gapId, brand_id: brandId },
    include: {
      buyer_journeys: { select: { query: true, stage: true, intent_type: true } },
    },
  })

  if (!gap) return c.json({ error: 'Gap not found' }, 404)

  return c.json({
    ...gap,
    query: gap.buyer_journeys.query,
    stage: gap.buyer_journeys.stage,
    intent_type: gap.buyer_journeys.intent_type,
    buyer_journeys: undefined,
  })
})

// POST /dismiss/:gapId — dismiss gap (requires member)
geoGaps.post('/dismiss/:gapId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const gapId = c.req.param('gapId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const gap = await db.geo_gaps.findFirst({
    where: { id: gapId, brand_id: brandId },
  })

  if (!gap) return c.json({ error: 'Gap not found' }, 404)

  await db.geo_gaps.update({
    where: { id: gapId },
    data: { dismissed_at: new Date() },
  })

  return c.json({ success: true })
})

export default geoGaps
