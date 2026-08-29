import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { runSeoAgent, getSeoRunStatus } from '../lib/seo-agent.js'

const seoAgent = new Hono<AppEnv>()

// POST /run — trigger seo agent run
seoAgent.post('/run', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const run = await db.seo_agent_runs.create({
    data: {
      brand_id: brandId,
      org_id: organizationId,
      status: 'pending',
      trigger: 'manual',
    },
  })

  setImmediate(() => runSeoAgent(run.id, brandId, organizationId).catch(console.error))

  return c.json({ run_id: run.id, status: 'queued' }, 202)
})

// GET /runs — list runs for brand
seoAgent.get('/runs', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  const runs = await db.seo_agent_runs.findMany({
    where: { brand_id: brandId },
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  return c.json(runs)
})

// GET /runs/:runId — run detail with actions
seoAgent.get('/runs/:runId', requireAuth, requireOrgRole('viewer'), async (c) => {
  const runId = c.req.param('runId')

  const run = await getSeoRunStatus(runId)
  if (!run) return c.json({ error: 'Run not found' }, 404)

  return c.json(run)
})

// GET /runs/:runId/actions — list actions for run
seoAgent.get('/runs/:runId/actions', requireAuth, requireOrgRole('viewer'), async (c) => {
  const runId = c.req.param('runId')

  const actions = await db.seo_agent_actions.findMany({
    where: { agent_run_id: runId },
  })

  return c.json(actions)
})

export default seoAgent
