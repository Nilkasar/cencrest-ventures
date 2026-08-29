import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { executeSchedule, getScheduleStatus } from '../lib/autonomous-ops.js'

const autonomous = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// GET /schedules
autonomous.get('/schedules', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const schedules = await db.autonomous_schedules.findMany({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
  })

  return c.json(schedules)
})

// POST /schedules
autonomous.post(
  '/schedules',
  requireAuth,
  requireOrgRole('admin'),
  zValidator('json', z.object({
    schedule_type: z.enum(['growth_agent', 'process_signals', 'sync_actions', 'full_pipeline']),
    cron_expression: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')

    const schedule = await db.autonomous_schedules.create({
      data: {
        brand_id: brandId,
        org_id: organizationId,
        schedule_type: body.schedule_type,
        cron_expression: body.cron_expression ?? null,
        config: body.config ?? {},
        enabled: true,
        run_count: 0,
      },
    })

    return c.json(schedule, 201)
  },
)

// GET /schedules/:scheduleId
autonomous.get('/schedules/:scheduleId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const scheduleId = c.req.param('scheduleId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const result = await getScheduleStatus(scheduleId)
  if (!result) return c.json({ error: 'Schedule not found' }, 404)

  return c.json(result)
})

// PATCH /schedules/:scheduleId
autonomous.patch(
  '/schedules/:scheduleId',
  requireAuth,
  requireOrgRole('admin'),
  zValidator('json', z.object({
    enabled: z.boolean().optional(),
    cron_expression: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const scheduleId = c.req.param('scheduleId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const existing = await db.autonomous_schedules.findFirst({
      where: { id: scheduleId, brand_id: brandId },
    })
    if (!existing) return c.json({ error: 'Schedule not found' }, 404)

    const body = c.req.valid('json')

    const updateData: Record<string, unknown> = { updated_at: new Date() }
    if (body.enabled !== undefined) updateData.enabled = body.enabled
    if (body.cron_expression !== undefined) updateData.cron_expression = body.cron_expression
    if (body.config !== undefined) updateData.config = body.config

    const updated = await db.autonomous_schedules.update({
      where: { id: scheduleId },
      data: updateData,
    })

    return c.json(updated)
  },
)

// DELETE /schedules/:scheduleId
autonomous.delete('/schedules/:scheduleId', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const scheduleId = c.req.param('scheduleId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const existing = await db.autonomous_schedules.findFirst({
    where: { id: scheduleId, brand_id: brandId },
  })
  if (!existing) return c.json({ error: 'Schedule not found' }, 404)

  await db.autonomous_schedules.delete({ where: { id: scheduleId } })

  return c.json({ success: true })
})

// POST /schedules/:scheduleId/trigger
autonomous.post('/schedules/:scheduleId/trigger', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const scheduleId = c.req.param('scheduleId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const schedule = await db.autonomous_schedules.findFirst({
    where: { id: scheduleId, brand_id: brandId },
  })
  if (!schedule) return c.json({ error: 'Schedule not found' }, 404)

  setImmediate(() => executeSchedule(scheduleId).catch(console.error))

  return c.json({ queued: true }, 202)
})

// GET /logs
autonomous.get('/logs', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const logs = await db.autonomous_run_logs.findMany({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
    take: 50,
  })

  return c.json(logs)
})

export default autonomous
