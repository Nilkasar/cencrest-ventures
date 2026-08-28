import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth } from '../middleware/auth.js'

const notifications = new Hono<AppEnv>()

const NOTIFICATION_TYPES = [
  'run_complete',
  'new_recommendations',
  'competitor_alert',
  'score_change',
  'agent_action',
  'report_ready',
  'action_assigned',
  'billing_alert',
] as const

const CHANNELS = ['in_app', 'email'] as const

// GET / — list user's notifications
notifications.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)))
  const skip = (page - 1) * limit

  const [rows, unreadCount] = await Promise.all([
    db.notifications.findMany({
      where: { user_id: user.id },
      orderBy: [
        { read_at: { sort: 'asc', nulls: 'first' } },
        { created_at: 'desc' },
      ],
      skip,
      take: limit,
    }),
    db.notifications.count({
      where: { user_id: user.id, read_at: null },
    }),
  ])

  return c.json({ notifications: rows, unread_count: unreadCount, page, limit })
})

// PATCH /:notificationId/read — mark single notification as read
notifications.patch('/:notificationId/read', requireAuth, async (c) => {
  const user = c.get('user')
  const notificationId = c.req.param('notificationId')

  const existing = await db.notifications.findUnique({
    where: { id: notificationId },
  })

  if (!existing || existing.user_id !== user.id) {
    return c.json({ error: 'Notification not found' }, 404)
  }

  const updated = await db.notifications.update({
    where: { id: notificationId },
    data: { read_at: new Date() },
  })

  return c.json(updated)
})

// POST /mark-all-read
notifications.post('/mark-all-read', requireAuth, async (c) => {
  const user = c.get('user')

  await db.notifications.updateMany({
    where: { user_id: user.id, read_at: null },
    data: { read_at: new Date() },
  })

  return c.json({ success: true })
})

// GET /preferences
notifications.get('/preferences', requireAuth, async (c) => {
  const user = c.get('user')

  const prefs = await db.notification_preferences.findMany({
    where: { user_id: user.id },
  })

  const matrix: Array<{ notification_type: string; channel: string; enabled: boolean }> = []

  for (const type of NOTIFICATION_TYPES) {
    for (const channel of CHANNELS) {
      const pref = prefs.find((p) => p.notification_type === type && p.channel === channel)
      matrix.push({
        notification_type: type,
        channel,
        enabled: pref ? pref.enabled : true,
      })
    }
  }

  return c.json({ preferences: matrix })
})

// PATCH /preferences
notifications.patch(
  '/preferences',
  requireAuth,
  zValidator(
    'json',
    z.object({
      preferences: z.array(
        z.object({
          notification_type: z.enum(NOTIFICATION_TYPES),
          channel: z.enum(CHANNELS),
          enabled: z.boolean(),
        }),
      ),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const { preferences } = c.req.valid('json')

    await Promise.all(
      preferences.map((pref) =>
        db.notification_preferences.upsert({
          where: {
            user_id_notification_type_channel: {
              user_id: user.id,
              notification_type: pref.notification_type,
              channel: pref.channel,
            },
          },
          create: {
            user_id: user.id,
            notification_type: pref.notification_type,
            channel: pref.channel,
            enabled: pref.enabled,
          },
          update: { enabled: pref.enabled },
        }),
      ),
    )

    return c.json({ success: true })
  },
)

export default notifications
