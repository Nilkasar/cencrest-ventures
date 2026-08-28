import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { validateDomain } from '../lib/meta-fetch.js'
import { requireAuth } from '../middleware/auth.js'
import { runSnapshot } from '../lib/snapshot-pipeline.js'

const snapshots = new Hono<AppEnv>()

const submitSchema = z.object({
  domain: z.string().min(1),
  email: z.string().email(),
  marketing_consent: z.boolean().optional(),
})

// POST /api/snapshots
snapshots.post('/', zValidator('json', submitSchema), async (c) => {
  const body = c.req.valid('json')

  const domain = validateDomain(body.domain)
  if (!domain) {
    return c.json({ error: 'Invalid or private domain' }, 422)
  }

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    'unknown'

  // Rate limit by IP: max 3 per 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const ipCount = await db.snapshot_requests.count({
    where: {
      ip_address: ip,
      created_at: { gt: oneDayAgo },
    },
  })
  if (ipCount >= 3) {
    return c.json({ error: 'Rate limit exceeded. Maximum 3 snapshots per IP per 24 hours.' }, 429)
  }

  // Rate limit by domain: once per 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const existing = await db.snapshot_requests.findFirst({
    where: {
      domain,
      created_at: { gt: sevenDaysAgo },
    },
    orderBy: { created_at: 'desc' },
  })
  if (existing) {
    return c.json(
      { error: 'Domain already snapshotted recently', snapshotId: existing.id },
      429,
    )
  }

  const snapshot = await db.snapshot_requests.create({
    data: {
      domain,
      email: body.email,
      marketing_consent: body.marketing_consent ?? false,
      ip_address: ip,
      status: 'pending',
    },
  })

  setImmediate(() => { void runSnapshot(snapshot.id) })

  return c.json({ snapshotId: snapshot.id, message: 'Snapshot started' }, 202)
})

// GET /api/snapshots/:snapshotId
snapshots.get('/:snapshotId', async (c) => {
  const snapshotId = c.req.param('snapshotId')

  const snapshot = await db.snapshot_requests.findUnique({
    where: { id: snapshotId },
  })

  if (!snapshot) {
    return c.json({ error: 'Snapshot not found' }, 404)
  }

  if (snapshot.status === 'pending' || snapshot.status === 'processing') {
    return c.json({ status: snapshot.status, message: 'Processing...' }, 202)
  }

  if (snapshot.status === 'failed') {
    const resultJson = snapshot.result_json as Record<string, unknown> | null
    return c.json({ status: snapshot.status, error: resultJson?.error ?? 'Snapshot failed' }, 500)
  }

  // complete
  if (snapshot.expires_at < new Date()) {
    return c.json({ error: 'Snapshot has expired' }, 410)
  }

  return c.json({
    ...(snapshot.result_json as Record<string, unknown>),
    domain: snapshot.domain,
    status: snapshot.status,
    createdAt: snapshot.created_at,
  })
})

// POST /api/snapshots/:snapshotId/convert
snapshots.post('/:snapshotId/convert', requireAuth, zValidator('json', z.object({ orgId: z.string() })), async (c) => {
  const snapshotId = c.req.param('snapshotId')
  const { orgId } = c.req.valid('json')

  const snapshot = await db.snapshot_requests.findUnique({ where: { id: snapshotId } })
  if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404)
  if (snapshot.status !== 'complete') return c.json({ error: 'Snapshot is not complete' }, 400)

  const updated = await db.snapshot_requests.update({
    where: { id: snapshotId },
    data: {
      converted_to_org_id: orgId,
      converted_at: new Date(),
      updated_at: new Date(),
    },
  })

  return c.json({ success: true, snapshotId: updated.id, orgId })
})

export default snapshots
