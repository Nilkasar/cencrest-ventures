import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { executeRun } from '../lib/prompt-runner.js'

const runs = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

// POST / — trigger a run
runs.post(
  '/',
  requireAuth,
  requireOrgRole('member'),
  zValidator('json', z.object({ trigger: z.enum(['manual', 'scheduled']).optional() })),
  async (c) => {
    const { organizationId } = c.get('org')
    const brandId = c.req.param('brandId')
    const body = c.req.valid('json')

    const brand = await getBrand(brandId, organizationId)
    if (!brand) return c.json({ error: 'Brand not found' }, 404)

    // Check for active run
    const active = await db.prompt_runs.findFirst({
      where: { brand_id: brandId, status: { in: ['queued', 'running'] } },
    })
    if (active) return c.json({ error: 'A run is already active', runId: active.id }, 409)

    const run = await db.prompt_runs.create({
      data: {
        brand_id: brandId,
        trigger: body.trigger ?? 'manual',
        status: 'queued',
      },
    })

    // Fire-and-forget
    setImmediate(() => executeRun(run.id, brandId))

    return c.json(run, 202)
  },
)

// GET / — list runs for brand, paginated
runs.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit

  const [total, data] = await Promise.all([
    db.prompt_runs.count({ where: { brand_id: brandId } }),
    db.prompt_runs.findMany({
      where: { brand_id: brandId },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

// GET /:runId — run detail with stats
runs.get('/:runId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.prompt_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  const responses = await db.ai_responses.findMany({
    where: { prompt_jobs: { run_id: runId } },
  })

  const successRate = run.total_prompts > 0
    ? (responses.length / run.total_prompts) * 100
    : 0

  const avgLatency = responses.length > 0
    ? responses.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / responses.length
    : 0

  const totalCost = 0 // cost_usd not stored in ai_responses

  return c.json({ ...run, successRate, avgLatency, totalCost })
})

// GET /:runId/progress — SSE stream
runs.get('/:runId/progress', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.prompt_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  return streamSSE(c, async (stream) => {
    const terminal = new Set(['complete', 'failed', 'cancelled'])

    while (true) {
      const current = await db.prompt_runs.findFirst({ where: { id: runId } })
      if (!current) break

      await stream.writeSSE({
        data: JSON.stringify({
          completed: current.completed_prompts,
          total: current.total_prompts,
          status: current.status,
        }),
      })

      if (terminal.has(current.status)) break

      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    }
  })
})

// DELETE /:runId — cancel run
runs.delete('/:runId', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.prompt_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  const updated = await db.prompt_runs.update({
    where: { id: runId },
    data: { status: 'cancelled', updated_at: new Date() },
  })

  return c.json(updated)
})

// GET /:runId/responses — paginated ai_responses
runs.get('/:runId/responses', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.prompt_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
  const skip = (page - 1) * limit
  const providerFilter = c.req.query('provider')

  const where = {
    prompt_jobs: { run_id: runId },
    ...(providerFilter ? { provider_name: providerFilter } : {}),
  }

  const [total, data] = await Promise.all([
    db.ai_responses.count({ where }),
    db.ai_responses.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return c.json({ total, page, limit, data })
})

export default runs
