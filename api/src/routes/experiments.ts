import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import {
  analyzeExperiment,
  recordMeasurement,
  startExperiment,
  endExperiment,
} from '../lib/experimentation.js'

const experiments = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// GET / — list experiments
experiments.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const statusParam = c.req.query('status')
  const where: Record<string, unknown> = {
    brand_id: brandId,
    deleted_at: null,
    ...(statusParam ? { status: statusParam } : {}),
  }

  const data = await db.experiments.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(data)
})

// POST / — create experiment
experiments.post(
  '/',
  requireAuth,
  requireOrgRole('member'),
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      hypothesis: z.string().optional(),
      experiment_type: z.string().min(1).max(100),
      success_metric: z.string().max(100).optional(),
      baseline_value: z.number().optional(),
      target_value: z.number().optional(),
      control_config: z.record(z.unknown()).optional(),
      variant_config: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const userId = c.get('user').id

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')

    const experiment = await db.experiments.create({
      data: {
        brand_id: brandId,
        org_id: organizationId,
        name: body.name,
        description: body.description,
        hypothesis: body.hypothesis,
        experiment_type: body.experiment_type,
        status: 'draft',
        success_metric: body.success_metric,
        baseline_value: body.baseline_value,
        target_value: body.target_value,
        control_config: body.control_config ?? {},
        variant_config: body.variant_config ?? {},
        created_by: userId,
      },
    })

    return c.json(experiment, 201)
  },
)

// GET /:experimentId
experiments.get('/:experimentId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const experimentId = c.req.param('experimentId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const experiment = await db.experiments.findFirst({
    where: { id: experimentId, brand_id: brandId, deleted_at: null },
  })
  if (!experiment) return c.json({ error: 'Experiment not found' }, 404)

  return c.json(experiment)
})

// DELETE /:experimentId
experiments.delete('/:experimentId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const experimentId = c.req.param('experimentId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const experiment = await db.experiments.findFirst({
    where: { id: experimentId, brand_id: brandId, deleted_at: null },
  })
  if (!experiment) return c.json({ error: 'Experiment not found' }, 404)

  await db.experiments.update({
    where: { id: experimentId },
    data: { deleted_at: new Date() },
  })

  return c.json({ deleted: true })
})

// POST /:experimentId/start
experiments.post('/:experimentId/start', requireAuth, requireOrgRole('member'), async (c) => {
  const experimentId = c.req.param('experimentId')
  startExperiment(experimentId).catch(() => {})
  return c.json({ queued: true }, 202)
})

// POST /:experimentId/end
experiments.post('/:experimentId/end', requireAuth, requireOrgRole('member'), async (c) => {
  const experimentId = c.req.param('experimentId')
  endExperiment(experimentId).catch(() => {})
  return c.json({ queued: true }, 202)
})

// POST /:experimentId/measure
experiments.post(
  '/:experimentId/measure',
  requireAuth,
  requireOrgRole('member'),
  zValidator(
    'json',
    z.object({
      variant: z.enum(['control', 'variant']),
      metric_name: z.string().min(1),
      metric_value: z.number(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const experimentId = c.req.param('experimentId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    await recordMeasurement(
      experimentId,
      brandId,
      body.variant,
      body.metric_name,
      body.metric_value,
      body.metadata,
    )

    return c.json({ recorded: true }, 201)
  },
)

// GET /:experimentId/measurements
experiments.get('/:experimentId/measurements', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const experimentId = c.req.param('experimentId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const data = await db.experiment_measurements.findMany({
    where: { experiment_id: experimentId },
    orderBy: { measured_at: 'desc' },
  })

  return c.json(data)
})

// GET /:experimentId/results
experiments.get('/:experimentId/results', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const experimentId = c.req.param('experimentId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  analyzeExperiment(experimentId).catch(() => {})

  const experiment = await db.experiments.findFirst({
    where: { id: experimentId, brand_id: brandId, deleted_at: null },
  })
  if (!experiment) return c.json({ error: 'Experiment not found' }, 404)

  return c.json({
    result_summary: experiment.result_summary,
    winner: experiment.winner,
    status: experiment.status,
  })
})

export default experiments
