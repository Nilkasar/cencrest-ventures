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

// ── Alias routes for frontend compatibility ─────────────────────────────────

// GET /schedule - return first schedule for brand
autonomous.get('/schedule', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const schedule = await db.autonomous_schedules.findFirst({
    where: { brand_id: brandId, org_id: organizationId },
    orderBy: { created_at: 'asc' },
  })

  const runCount = schedule
    ? await db.autonomous_run_logs.count({ where: { org_id: organizationId } })
    : 0

  return c.json({
    schedule: schedule ? {
      id: schedule.id,
      enabled: schedule.enabled,
      schedule_type: schedule.schedule_type,
      cron_expression: schedule.cron_expression,
      config: schedule.config,
      run_count: schedule.run_count,
    } : null,
    status: {
      next_run: schedule?.next_run_at ?? null,
      last_run: schedule?.last_run_at ?? null,
      last_status: null,
      total_runs: runCount,
    },
  })
})

// PATCH /schedule - update or create first schedule
autonomous.patch('/schedule', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const body = await c.req.json().catch(() => ({}))

  const existing = await db.autonomous_schedules.findFirst({
    where: { brand_id: brandId, org_id: organizationId },
  })

  if (existing) {
    const updated = await db.autonomous_schedules.update({
      where: { id: existing.id },
      data: {
        enabled: body.enabled ?? existing.enabled,
        schedule_type: body.schedule_type ?? existing.schedule_type,
        cron_expression: body.cron_expression ?? existing.cron_expression,
        config: body.config ?? existing.config,
        updated_at: new Date(),
      },
    })
    return c.json({ success: true, schedule: updated })
  } else {
    const created = await db.autonomous_schedules.create({
      data: {
        brand_id: brandId,
        org_id: organizationId,
        schedule_type: body.schedule_type ?? 'weekly',
        cron_expression: body.cron_expression ?? '0 9 * * 1',
        enabled: body.enabled ?? false,
        config: body.config ?? {},
      },
    })
    return c.json({ success: true, schedule: created })
  }
})

// POST /schedule/run - trigger immediately
autonomous.post('/schedule/run', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const schedule = await db.autonomous_schedules.findFirst({
    where: { brand_id: brandId, org_id: organizationId },
  })

  const log = await db.autonomous_run_logs.create({
    data: {
      org_id: organizationId,
      triggered_by: c.get('user').id,
      status: 'pending',
      config: schedule ? { schedule_id: schedule.id } : {},
    },
  })
  return c.json({ success: true, runId: log.id, message: 'Run triggered' })
})

// GET /runs - execution history
autonomous.get('/runs', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const logs = await db.autonomous_run_logs.findMany({
    where: { org_id: organizationId },
    orderBy: { started_at: 'desc' },
    take: 50,
  })

  return c.json({ runs: logs })
})

export default autonomous
