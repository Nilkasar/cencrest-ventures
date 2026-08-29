import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const marketing = new Hono<AppEnv>()

// ── Campaign schemas ──────────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  campaign_type: z.string().min(1).max(100),
  target_audience: z.record(z.unknown()).optional(),
  channels: z.array(z.string()).optional(),
  budget: z.number().positive().optional(),
})

const patchCampaignSchema = z.object({
  name: z.string().max(255).optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']).optional(),
  target_audience: z.record(z.unknown()).optional(),
  channels: z.array(z.string()).optional(),
  budget: z.number().positive().optional(),
})

const metricsSchema = z.object({
  metrics: z.record(z.number()),
})

// ── Growth lever schemas ──────────────────────────────────────────────────────

const createLeverSchema = z.object({
  lever_type: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  estimated_impact: z.number().min(0).max(100).optional(),
  effort_level: z.enum(['low', 'medium', 'high']).optional(),
})

const patchLeverSchema = z.object({
  status: z.enum(['identified', 'activating', 'active', 'completed']).optional(),
  result_metrics: z.record(z.unknown()).optional(),
})

// ── Campaigns ─────────────────────────────────────────────────────────────────

// GET /campaigns
marketing.get('/campaigns', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const statusParam = c.req.query('status')
  const typeParam = c.req.query('type')

  const where: Record<string, unknown> = {
    org_id: organizationId,
    deleted_at: null,
    ...(statusParam ? { status: statusParam } : {}),
    ...(typeParam ? { campaign_type: typeParam } : {}),
  }

  const campaigns = await db.marketing_campaigns.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(campaigns)
})

// POST /campaigns
marketing.post('/campaigns', requireAuth, requireOrgRole('member'), zValidator('json', createCampaignSchema), async (c) => {
  const { organizationId } = c.get('org')
  const userId = c.get('user').id
  const body = c.req.valid('json')

  const campaign = await db.marketing_campaigns.create({
    data: {
      org_id: organizationId,
      name: body.name,
      campaign_type: body.campaign_type,
      target_audience: body.target_audience ?? {},
      channels: body.channels ?? [],
      budget: body.budget,
      created_by: userId,
    },
  })

  return c.json(campaign, 201)
})

// GET /campaigns/:campaignId
marketing.get('/campaigns/:campaignId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const campaignId = c.req.param('campaignId')

  const campaign = await db.marketing_campaigns.findFirst({
    where: { id: campaignId, org_id: organizationId, deleted_at: null },
  })

  if (!campaign) return c.json({ error: 'Not found' }, 404)
  return c.json(campaign)
})

// PATCH /campaigns/:campaignId
marketing.patch('/campaigns/:campaignId', requireAuth, requireOrgRole('member'), zValidator('json', patchCampaignSchema), async (c) => {
  const { organizationId } = c.get('org')
  const campaignId = c.req.param('campaignId')
  const body = c.req.valid('json')

  const existing = await db.marketing_campaigns.findFirst({
    where: { id: campaignId, org_id: organizationId, deleted_at: null },
  })

  if (!existing) return c.json({ error: 'Not found' }, 404)

  const data: Record<string, unknown> = { ...body, updated_at: new Date() }

  if (body.status === 'active' && !(existing as Record<string, unknown>).started_at) {
    data.started_at = new Date()
  }
  if (body.status === 'completed' || body.status === 'cancelled') {
    data.ended_at = new Date()
  }

  const updated = await db.marketing_campaigns.update({
    where: { id: campaignId },
    data,
  })

  return c.json(updated)
})

// DELETE /campaigns/:campaignId
marketing.delete('/campaigns/:campaignId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const campaignId = c.req.param('campaignId')

  const existing = await db.marketing_campaigns.findFirst({
    where: { id: campaignId, org_id: organizationId, deleted_at: null },
  })

  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.marketing_campaigns.update({
    where: { id: campaignId },
    data: { deleted_at: new Date() },
  })

  return c.json({ success: true })
})

// POST /campaigns/:campaignId/metrics
marketing.post('/campaigns/:campaignId/metrics', requireAuth, requireOrgRole('member'), zValidator('json', metricsSchema), async (c) => {
  const { organizationId } = c.get('org')
  const campaignId = c.req.param('campaignId')
  const body = c.req.valid('json')

  const existing = await db.marketing_campaigns.findFirst({
    where: { id: campaignId, org_id: organizationId, deleted_at: null },
  })

  if (!existing) return c.json({ error: 'Not found' }, 404)

  const currentMetrics = (existing as Record<string, unknown>).metrics as Record<string, number> ?? {}
  const mergedMetrics = { ...currentMetrics, ...body.metrics }

  const updated = await db.marketing_campaigns.update({
    where: { id: campaignId },
    data: { metrics: mergedMetrics, updated_at: new Date() },
  })

  return c.json(updated)
})

// ── Growth Levers ─────────────────────────────────────────────────────────────

// GET /levers
marketing.get('/levers', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const statusParam = c.req.query('status')

  const where: Record<string, unknown> = {
    org_id: organizationId,
    ...(statusParam ? { status: statusParam } : {}),
  }

  const levers = await db.growth_levers.findMany({
    where,
    orderBy: { estimated_impact: 'desc' },
  })

  return c.json(levers)
})

// POST /levers
marketing.post('/levers', requireAuth, requireOrgRole('member'), zValidator('json', createLeverSchema), async (c) => {
  const { organizationId } = c.get('org')
  const body = c.req.valid('json')

  const lever = await db.growth_levers.create({
    data: {
      org_id: organizationId,
      lever_type: body.lever_type,
      title: body.title,
      description: body.description,
      estimated_impact: body.estimated_impact,
      effort_level: body.effort_level,
    },
  })

  return c.json(lever, 201)
})

// PATCH /levers/:leverId
marketing.patch('/levers/:leverId', requireAuth, requireOrgRole('member'), zValidator('json', patchLeverSchema), async (c) => {
  const { organizationId } = c.get('org')
  const leverId = c.req.param('leverId')
  const body = c.req.valid('json')

  const existing = await db.growth_levers.findFirst({
    where: { id: leverId, org_id: organizationId },
  })

  if (!existing) return c.json({ error: 'Not found' }, 404)

  const data: Record<string, unknown> = { ...body, updated_at: new Date() }

  if (body.status === 'active') {
    data.activated_at = new Date()
  }

  const updated = await db.growth_levers.update({
    where: { id: leverId },
    data,
  })

  return c.json(updated)
})

// ── Summary ───────────────────────────────────────────────────────────────────

// GET /summary
marketing.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const [campaigns, levers] = await Promise.all([
    db.marketing_campaigns.findMany({ where: { org_id: organizationId, deleted_at: null } }),
    db.growth_levers.findMany({ where: { org_id: organizationId } }),
  ])

  // campaigns by_status
  const campaignsByStatus: Record<string, number> = {}
  for (const camp of campaigns) {
    const s = (camp as Record<string, unknown>).status as string
    campaignsByStatus[s] = (campaignsByStatus[s] ?? 0) + 1
  }

  // levers by_status
  const leversByStatus: Record<string, number> = {}
  let impactSum = 0
  let impactCount = 0
  for (const lever of levers) {
    const s = (lever as Record<string, unknown>).status as string
    leversByStatus[s] = (leversByStatus[s] ?? 0) + 1
    const impact = (lever as Record<string, unknown>).estimated_impact as number | null
    if (impact != null) {
      impactSum += Number(impact)
      impactCount++
    }
  }

  return c.json({
    campaigns: {
      total: campaigns.length,
      by_status: campaignsByStatus,
    },
    levers: {
      total: levers.length,
      by_status: leversByStatus,
      avg_estimated_impact: impactCount > 0 ? impactSum / impactCount : 0,
    },
  })
})

export default marketing
