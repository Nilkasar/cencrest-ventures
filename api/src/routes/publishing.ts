import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import {
  submitForApproval,
  approveJob,
  rejectJob,
  scheduleJob,
  executePublish,
} from '../lib/publisher.js'

const publishing = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// GET / — list publish jobs
publishing.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const statusParam = c.req.query('status')

  const where: Record<string, unknown> = {
    brand_id: brandId,
    deleted_at: null,
    ...(statusParam ? { status: statusParam } : {}),
  }

  const [total, data] = await Promise.all([
    db.publish_jobs.count({ where }),
    db.publish_jobs.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// POST / — create publish job
publishing.post(
  '/',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    generated_content_id: z.string().uuid().optional(),
    action_id: z.string().uuid().optional(),
    destination: z.string().min(1).max(100),
    destination_config: z.record(z.unknown()).optional(),
    scheduled_at: z.string().datetime().optional(),
    approval_required: z.boolean().optional(),
  })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    const body = c.req.valid('json')
    const userId = c.get('userId')

    const job = await db.publish_jobs.create({
      data: {
        brand_id: brandId,
        org_id: organizationId,
        generated_content_id: body.generated_content_id ?? null,
        action_id: body.action_id ?? null,
        destination: body.destination,
        destination_config: body.destination_config ?? {},
        status: 'draft',
        scheduled_at: body.scheduled_at ? new Date(body.scheduled_at) : null,
        approval_required: body.approval_required ?? false,
        created_by: userId,
        publish_log: [],
      },
    })

    return c.json(job, 201)
  },
)

// GET /:jobId
publishing.get('/:jobId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const jobId = c.req.param('jobId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const job = await db.publish_jobs.findFirst({
    where: { id: jobId, brand_id: brandId, deleted_at: null },
  })
  if (!job) return c.json({ error: 'Publish job not found' }, 404)

  return c.json(job)
})

// DELETE /:jobId — soft delete
publishing.delete('/:jobId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const jobId = c.req.param('jobId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const job = await db.publish_jobs.findFirst({
    where: { id: jobId, brand_id: brandId, deleted_at: null },
  })
  if (!job) return c.json({ error: 'Publish job not found' }, 404)

  await db.publish_jobs.update({
    where: { id: jobId },
    data: { deleted_at: new Date() },
  })

  return c.json({ success: true })
})

// POST /:jobId/submit
publishing.post('/:jobId/submit', requireAuth, requireOrgRole('member'), async (c) => {
  const jobId = c.req.param('jobId')
  setImmediate(() => { submitForApproval(jobId).catch(() => {}) })
  return c.json({ queued: true }, 202)
})

// POST /:jobId/approve
publishing.post('/:jobId/approve', requireAuth, requireOrgRole('admin'), async (c) => {
  const jobId = c.req.param('jobId')
  const userId = c.get('userId')
  setImmediate(() => { approveJob(jobId, userId).catch(() => {}) })
  return c.json({ queued: true }, 202)
})

// POST /:jobId/reject
publishing.post(
  '/:jobId/reject',
  requireAuth,
  requireOrgRole('admin'),
  zValidator('json', z.object({
    reason: z.string().min(1),
  })),
  async (c) => {
    const jobId = c.req.param('jobId')
    const { reason } = c.req.valid('json')
    setImmediate(() => { rejectJob(jobId, reason).catch(() => {}) })
    return c.json({ queued: true }, 202)
  },
)

// POST /:jobId/schedule
publishing.post(
  '/:jobId/schedule',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({
    scheduled_at: z.string().datetime(),
  })),
  async (c) => {
    const jobId = c.req.param('jobId')
    const { scheduled_at } = c.req.valid('json')
    setImmediate(() => { scheduleJob(jobId, new Date(scheduled_at)).catch(() => {}) })
    return c.json({ queued: true }, 202)
  },
)

// POST /:jobId/publish
publishing.post('/:jobId/publish', requireAuth, requireOrgRole('member'), async (c) => {
  const jobId = c.req.param('jobId')
  setImmediate(() => { executePublish(jobId).catch(() => {}) })
  return c.json({ queued: true }, 202)
})

// GET /:jobId/log
publishing.get('/:jobId/log', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const jobId = c.req.param('jobId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const job = await db.publish_jobs.findFirst({
    where: { id: jobId, brand_id: brandId, deleted_at: null },
  })

  return c.json(Array.isArray(job?.publish_log) ? job.publish_log : [])
})

export default publishing
