import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import {
  syncActionsFromRecommendations,
  syncActionsFromGeoGaps,
  dismissAction,
  completeAction,
} from '../lib/action-center.js'

const actions = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// GET /summary — must be before /:actionId
actions.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const baseWhere = { brand_id: brandId, deleted_at: null as null }

  const [total, pending, in_progress, completed, dismissed, critical, high, medium, low] = await Promise.all([
    db.actions.count({ where: baseWhere }),
    db.actions.count({ where: { ...baseWhere, status: 'pending' } }),
    db.actions.count({ where: { ...baseWhere, status: 'in_progress' } }),
    db.actions.count({ where: { ...baseWhere, status: 'completed' } }),
    db.actions.count({ where: { ...baseWhere, status: 'dismissed' } }),
    db.actions.count({ where: { ...baseWhere, priority: 'critical' } }),
    db.actions.count({ where: { ...baseWhere, priority: 'high' } }),
    db.actions.count({ where: { ...baseWhere, priority: 'medium' } }),
    db.actions.count({ where: { ...baseWhere, priority: 'low' } }),
  ])

  return c.json({
    total,
    by_status: { pending, in_progress, completed, dismissed },
    by_priority: { critical, high, medium, low },
  })
})

// GET / — list actions
actions.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const statusParam = c.req.query('status')
  const priorityParam = c.req.query('priority')

  const where: Record<string, unknown> = {
    brand_id: brandId,
    deleted_at: null,
    ...(statusParam ? { status: statusParam } : {}),
    ...(priorityParam ? { priority: priorityParam } : {}),
  }

  const [total, data] = await Promise.all([
    db.actions.count({ where }),
    db.actions.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// POST /sync
actions.post('/sync', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const [fromRecs, fromGaps] = await Promise.all([
    syncActionsFromRecommendations(brandId, organizationId),
    syncActionsFromGeoGaps(brandId, organizationId),
  ])

  return c.json({ synced: fromRecs + fromGaps })
})

// POST / — create manual action
actions.post(
  '/',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    action_type: z.string().min(1),
    title: z.string().min(1).max(500),
    description: z.string().optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    due_date: z.string().datetime().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')

    const action = await db.actions.create({
      data: {
        brand_id: brandId,
        org_id: organizationId,
        action_type: body.action_type,
        title: body.title,
        description: body.description ?? null,
        priority: (body.priority ?? 'medium') as any,
        status: 'pending',
        source: 'manual',
        due_date: body.due_date ? new Date(body.due_date) : null,
      },
    })

    return c.json(action, 201)
  },
)

// PATCH /:actionId
actions.patch(
  '/:actionId',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    title: z.string().max(500).optional(),
    description: z.string().optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']).optional(),
    assigned_to: z.string().uuid().optional(),
    due_date: z.string().datetime().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const actionId = c.req.param('actionId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const existing = await db.actions.findFirst({
      where: { id: actionId, brand_id: brandId, deleted_at: null },
    })
    if (!existing) return c.json({ error: 'Action not found' }, 404)

    const body = c.req.valid('json')

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.assigned_to !== undefined ? { assigned_to: body.assigned_to } : {}),
      ...(body.due_date !== undefined ? { due_date: new Date(body.due_date) } : {}),
    }

    if (body.status === 'completed') {
      updateData.completed_at = new Date()
    }
    if (body.status === 'dismissed') {
      updateData.deleted_at = new Date()
    }

    const updated = await db.actions.update({
      where: { id: actionId },
      data: updateData,
    })

    return c.json(updated)
  },
)

// POST /:actionId/dismiss
actions.post('/:actionId/dismiss', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const actionId = c.req.param('actionId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  await dismissAction(actionId, brandId)
  return c.json({ success: true })
})

// POST /:actionId/complete
actions.post('/:actionId/complete', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const actionId = c.req.param('actionId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  await completeAction(actionId, brandId)
  return c.json({ success: true })
})

export default actions
