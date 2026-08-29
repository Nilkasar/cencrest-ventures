import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { runGrowthAgent } from '../lib/growth-agent.js'

const growthAgent = new Hono<AppEnv>()

async function getBrand(brandId: string, organizationId: string) {
  return db.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } })
}

growthAgent.post('/run', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.growth_agent_runs.create({
    data: { brand_id: brandId, org_id: organizationId, status: 'pending', trigger: 'manual' },
  })

  setImmediate(() => runGrowthAgent(run.id, brandId, organizationId).catch(console.error))

  return c.json({ run_id: run.id, status: 'queued' }, 202)
})

growthAgent.get('/runs', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const runs = await db.growth_agent_runs.findMany({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(runs)
})

growthAgent.get('/status', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const latest = await db.growth_agent_runs.findFirst({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
  })

  return c.json(latest ?? { status: 'never_run' })
})

growthAgent.get('/runs/:runId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const runId = c.req.param('runId')

  const brand = await getBrand(brandId, organizationId)
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.growth_agent_runs.findFirst({ where: { id: runId, brand_id: brandId } })
  if (!run) return c.json({ error: 'Run not found' }, 404)

  return c.json(run)
})

export default growthAgent
