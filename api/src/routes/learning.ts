import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { recordSignal, processSignals, getInsights, markInsightActioned } from '../lib/learning-loop.js'

const learning = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// POST /signals
learning.post(
  '/signals',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    signal_type: z.string().min(1),
    source: z.string().min(1),
    metric_name: z.string().min(1),
    metric_value: z.number(),
    source_id: z.string().uuid().optional(),
    delta: z.number().optional(),
    context: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')
    await recordSignal(brandId, body.signal_type, body.source, body.metric_name, body.metric_value, {
      sourceId: body.source_id,
      delta: body.delta,
      context: body.context,
    })

    return c.json({ recorded: true }, 201)
  },
)

// POST /process
learning.post('/process', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  setImmediate(() => processSignals(brandId).catch(console.error))
  return c.json({ queued: true }, 202)
})

// GET /signals
learning.get('/signals', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const processedParam = c.req.query('processed')
  const where: Record<string, unknown> = { brand_id: brandId }
  if (processedParam === 'true') where.processed = true
  else if (processedParam === 'false') where.processed = false

  const signals = await db.learning_signals.findMany({
    where,
    orderBy: { recorded_at: 'desc' },
    take: 50,
  })

  return c.json(signals)
})

// GET /insights
learning.get('/insights', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const insights = await getInsights(brandId)
  return c.json(insights)
})

// POST /insights/:insightId/action
learning.post(
  '/insights/:insightId/action',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    action_type: z.string().min(1),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const insightId = c.req.param('insightId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')
    await markInsightActioned(insightId, body.action_type)
    return c.json({ success: true })
  },
)

// GET /summary
learning.get('/summary', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const [total_signals, unprocessed_signals, total_insights, actioned_insights] = await Promise.all([
    db.learning_signals.count({ where: { brand_id: brandId } }),
    db.learning_signals.count({ where: { brand_id: brandId, processed: false } }),
    db.learning_insights.count({ where: { brand_id: brandId } }),
    db.learning_insights.count({ where: { brand_id: brandId, action_taken: true } }),
  ])

  return c.json({ total_signals, unprocessed_signals, total_insights, actioned_insights })
})

export default learning
