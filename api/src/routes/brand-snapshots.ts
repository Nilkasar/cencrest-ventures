import { Hono } from 'hono'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'

const brandSnapshots = new Hono<AppEnv>()

// GET / - list snapshots for brand
brandSnapshots.get('/', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')

  const brand = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // We'll store snapshots in a JSON approach using brand metadata
  // For now return empty list - real implementation would query a snapshots table
  return c.json({ snapshots: [] })
})

// POST / - take a new snapshot
brandSnapshots.post('/', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const brandId = c.req.param('brandId')
  const userId = c.get('user').id

  const brand = await db.brands.findFirst({
    where: { id: brandId, organization_id: organizationId, deleted_at: null },
  })
  if (!brand) return c.json({ error: 'Brand not found' }, 404)

  // Gather current scores from various tables
  const [geoGapCount, oppCount, actionCount, runCount] = await Promise.all([
    db.geo_gaps.count({ where: { brand_id: brandId } }),
    db.opportunities.count({ where: { brand_id: brandId } }),
    db.actions.count({ where: { brand_id: brandId } }),
    db.analysis_runs.count({ where: { brand_id: brandId } }),
  ])

  const snapshot = {
    id: crypto.randomUUID(),
    brand_id: brandId,
    label: `Snapshot ${new Date().toLocaleDateString()}`,
    created_at: new Date().toISOString(),
    created_by: userId,
    modules: ['geo', 'opportunities', 'actions', 'runs'],
    scores: {
      geo_gaps: geoGapCount,
      opportunities: oppCount,
      actions: actionCount,
      total_runs: runCount,
    },
  }

  // In a real implementation, persist to a snapshots table
  // For now return the computed snapshot
  return c.json({ snapshot, message: 'Snapshot captured' }, 201)
})

// DELETE /:snapshotId
brandSnapshots.delete('/:snapshotId', requireAuth, requireOrgRole('admin'), async (c) => {
  // Placeholder - would delete from snapshots table
  return c.json({ success: true })
})

export default brandSnapshots
