import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../lib/db.js'
import { computeHealthCheck, runInterventions, getAllHealthChecks } from '../lib/customer-success.js'

const customerSuccess = new Hono<AppEnv>()

// GET /summary — must be before /:orgId
customerSuccess.get('/summary', requireAuth, async (c) => {
  const all = await db.customer_health_checks.findMany({})
  const total = all.length
  const avg_health_score = total > 0
    ? Math.round(all.reduce((sum: number, r: { health_score: number }) => sum + r.health_score, 0) / total)
    : 0
  const by_churn_risk = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const r of all as { churn_risk: string }[]) {
    const risk = r.churn_risk as keyof typeof by_churn_risk
    if (risk in by_churn_risk) by_churn_risk[risk]++
  }
  return c.json({ total, avg_health_score, by_churn_risk })
})

// GET / — list all health checks
customerSuccess.get('/', requireAuth, async (c) => {
  const churn_risk = c.req.query('churn_risk')
  const checks = await getAllHealthChecks(churn_risk ? { churn_risk } : undefined)
  return c.json(checks)
})

// POST /compute-all — must be before /compute/:orgId to avoid shadowing
customerSuccess.post('/compute-all', requireAuth, async (c) => {
  const orgs = await db.organizations.findMany({ select: { id: true }, take: 100 })
  for (const org of orgs) {
    setImmediate(() => computeHealthCheck(org.id).catch(console.error))
  }
  return c.json({ queued: orgs.length }, 202)
})

// POST /compute/:orgId
customerSuccess.post('/compute/:orgId', requireAuth, async (c) => {
  const orgId = c.req.param('orgId')
  setImmediate(() => computeHealthCheck(orgId).catch(console.error))
  return c.json({ queued: true }, 202)
})

// POST /intervene/:orgId
customerSuccess.post('/intervene/:orgId', requireAuth, async (c) => {
  const orgId = c.req.param('orgId')
  setImmediate(() => runInterventions(orgId).catch(console.error))
  return c.json({ queued: true }, 202)
})

// GET /:orgId — must be last
customerSuccess.get('/:orgId', requireAuth, async (c) => {
  const orgId = c.req.param('orgId')
  const check = await db.customer_health_checks.findFirst({ where: { org_id: orgId } })
  if (!check) return c.json({ error: 'Not found' }, 404)
  return c.json(check)
})

export default customerSuccess
