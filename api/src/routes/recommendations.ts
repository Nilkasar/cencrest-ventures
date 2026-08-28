import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { generateRecommendations } from '../lib/recommendation-engine.js'

const recommendations = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

const VALID_SORT = ['roi_score', 'effort_estimate', 'created_at'] as const
type SortField = (typeof VALID_SORT)[number]

const VALID_STATUS = ['active', 'dismissed', 'snoozed', 'completed'] as const
const VALID_REC_TYPE = ['create_content', 'optimize_page', 'build_citation', 'earn_link', 'improve_entity', 'update_schema'] as const

// GET / — list recommendations
recommendations.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const statusParam = c.req.query('status') ?? 'active'
  const status = (VALID_STATUS as readonly string[]).includes(statusParam) ? statusParam : 'active'
  const recTypeParam = c.req.query('rec_type')
  const recType = recTypeParam && (VALID_REC_TYPE as readonly string[]).includes(recTypeParam) ? recTypeParam : undefined
  const sortParam = c.req.query('sort') ?? 'roi_score'
  const sort: SortField = (VALID_SORT as readonly string[]).includes(sortParam)
    ? (sortParam as SortField)
    : 'roi_score'

  const now = new Date()

  const where: Record<string, unknown> = {
    brand_id: brandId,
    status,
    ...(recType ? { rec_type: recType } : {}),
  }

  // For active status: exclude items that are snoozed and snoozed_until hasn't passed
  if (status === 'active') {
    where.OR = [
      { snoozed_until: null },
      { snoozed_until: { lt: now } },
    ]
  }

  const [total, data] = await Promise.all([
    db.recommendations.count({ where }),
    db.recommendations.findMany({
      where,
      orderBy: { [sort]: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// GET /summary
recommendations.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const baseWhere = { brand_id: brandId }

  const [
    create_content, optimize_page, build_citation, earn_link, improve_entity, update_schema,
    active, dismissed, snoozed, completed,
    allActive,
  ] = await Promise.all([
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'create_content' } }),
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'optimize_page' } }),
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'build_citation' } }),
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'earn_link' } }),
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'improve_entity' } }),
    db.recommendations.count({ where: { ...baseWhere, rec_type: 'update_schema' } }),
    db.recommendations.count({ where: { ...baseWhere, status: 'active' } }),
    db.recommendations.count({ where: { ...baseWhere, status: 'dismissed' } }),
    db.recommendations.count({ where: { ...baseWhere, status: 'snoozed' } }),
    db.recommendations.count({ where: { ...baseWhere, status: 'completed' } }),
    db.recommendations.findMany({ where: { ...baseWhere, status: 'active' }, select: { roi_score: true } }),
  ])

  const totalActive = active
  const avgRoiScore = totalActive > 0
    ? allActive.reduce((sum, r) => {
        const v = typeof r.roi_score === 'object'
          ? (r.roi_score as { toNumber(): number }).toNumber()
          : Number(r.roi_score)
        return sum + v
      }, 0) / totalActive
    : 0

  return c.json({
    byType: { create_content, optimize_page, build_citation, earn_link, improve_entity, update_schema },
    byStatus: { active, dismissed, snoozed, completed },
    totalActive,
    avgRoiScore,
  })
})

// GET /:recId — recommendation detail
recommendations.get('/:recId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const recId = c.req.param('recId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const rec = await db.recommendations.findFirst({
    where: { id: recId, brand_id: brandId },
  })

  if (!rec) return c.json({ error: 'Recommendation not found' }, 404)

  return c.json(rec)
})

// PATCH /:recId — update status
recommendations.patch(
  '/:recId',
  requireAuth,
  requireOrgRole('viewer'),
  zValidator('json', z.object({
    status: z.enum(['dismissed', 'snoozed', 'completed', 'active']),
    snoozed_until: z.string().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const recId = c.req.param('recId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const rec = await db.recommendations.findFirst({
      where: { id: recId, brand_id: brandId },
    })
    if (!rec) return c.json({ error: 'Recommendation not found' }, 404)

    const updateData: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date(),
    }

    if (body.status === 'completed') {
      updateData.completed_at = new Date()
    }

    if (body.status === 'snoozed' && body.snoozed_until) {
      updateData.snoozed_until = new Date(body.snoozed_until)
    }

    const updated = await db.recommendations.update({
      where: { id: recId },
      data: updateData,
    })

    return c.json(updated)
  },
)

// POST /generate — fire-and-forget generation
recommendations.post('/generate', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  setImmediate(() => {
    generateRecommendations(brandId).catch((err) => {
      console.error('generateRecommendations failed:', err)
    })
  })

  return c.json({ message: 'Generating recommendations' }, 202)
})

export default recommendations
