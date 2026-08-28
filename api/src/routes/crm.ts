import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth } from '../middleware/auth.js'

const crm = new Hono<AppEnv>()

// GET /accounts — list all orgs with account_health
crm.get('/accounts', requireAuth, async (c) => {
  const segment = c.req.query('segment')
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)))
  const skip = (page - 1) * limit

  const where: Record<string, any> = { deleted_at: null }
  if (segment === 'at_risk' || segment === 'churning' || segment === 'healthy') {
    where.account_health = { risk_level: segment }
  } else if (segment === 'trial') {
    where.subscriptions = { plan: 'free' }
  } else if (segment === 'active') {
    where.subscriptions = { plan: { not: 'free' }, status: 'active' }
  }

  const orgs = await db.organizations.findMany({
    where,
    skip,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: {
      subscriptions: { select: { plan: true, status: true } },
      account_health: {
        select: { health_score: true, risk_level: true, calculated_at: true },
      },
    },
  })

  const result = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    plan: o.subscriptions?.plan ?? 'free',
    health_score: o.account_health?.health_score ?? null,
    risk_level: o.account_health?.risk_level ?? null,
    calculated_at: o.account_health?.calculated_at ?? null,
  }))

  return c.json(result)
})

// GET /accounts/:orgId — single account detail
crm.get('/accounts/:orgId', requireAuth, async (c) => {
  const orgId = c.req.param('orgId')

  const org = await db.organizations.findUnique({
    where: { id: orgId },
    include: {
      subscriptions: true,
      account_health: true,
      _count: {
        select: {
          crm_contacts: true,
          crm_notes: true,
        },
      },
    },
  })

  if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404)

  return c.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    created_at: org.created_at,
    subscription: org.subscriptions,
    account_health: org.account_health,
    crm_contacts_count: org._count.crm_contacts,
    crm_notes_count: org._count.crm_notes,
  })
})

// POST /accounts/:orgId/notes — add a note
crm.post(
  '/accounts/:orgId/notes',
  requireAuth,
  zValidator('json', z.object({ content: z.string().min(1) })),
  async (c) => {
    const orgId = c.req.param('orgId')
    const user = c.get('user')
    const { content } = c.req.valid('json')

    const org = await db.organizations.findUnique({ where: { id: orgId } })
    if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404)

    const note = await db.crm_notes.create({
      data: {
        org_id: orgId,
        author_id: user.id,
        content,
      },
    })

    return c.json(note, 201)
  }
)

// GET /accounts/:orgId/events — activity timeline
crm.get('/accounts/:orgId/events', requireAuth, async (c) => {
  const orgId = c.req.param('orgId')

  const org = await db.organizations.findUnique({ where: { id: orgId } })
  if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404)

  const [notes, usageRecords] = await Promise.all([
    db.crm_notes.findMany({
      where: { org_id: orgId },
      orderBy: { created_at: 'desc' },
      take: 50,
    }),
    db.usage_records.findMany({
      where: { organization_id: orgId },
      orderBy: { recorded_at: 'desc' },
      take: 10,
    }),
  ])

  return c.json({ notes, usage_records: usageRecords })
})

export default crm
