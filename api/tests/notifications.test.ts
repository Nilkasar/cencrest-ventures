import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireAuth } from '../src/middleware/auth.js'
import notifications from '../src/routes/notifications.js'

const USER_ID = 'user-notif-0001'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-notif-0001', email: 'notif@bebest.dev', name: 'Notif User', deleted_at: null,
      }),
    },
    notifications: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'notif-0001',
          user_id: 'user-notif-0001',
          org_id: 'org-notif-0001',
          type: 'run_complete',
          title: 'Run finished',
          body: null,
          action_url: null,
          read_at: null,
          created_at: new Date(),
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({
        id: 'notif-0001',
        user_id: 'user-notif-0001',
        read_at: new Date(),
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    notification_preferences: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({
        id: 'pref-0001',
        user_id: 'user-notif-0001',
        notification_type: 'run_complete',
        channel: 'email',
        enabled: false,
      }),
    },
  },
}))

vi.mock('../src/lib/notify.js', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
  sendBulkNotification: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-notif-0001', 'Content-Type': 'application/json' }

// Build a standalone app for notifications (user-scoped, no org middleware)
function buildApp() {
  const app = new Hono()
  app.route('/api/notifications', notifications)
  return app
}

describe('GET /api/notifications', () => {
  it('returns list with unread_count', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.notifications)).toBe(true)
    expect(typeof body.unread_count).toBe('number')
  })

  it('returns 401 without auth', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/notifications/:id/read', () => {
  beforeEach(async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.notifications.findUnique).mockResolvedValue({
      id: 'notif-0001',
      user_id: 'user-notif-0001',
      org_id: 'org-notif-0001',
      type: 'run_complete',
      title: 'Run finished',
      body: null,
      action_url: null,
      read_at: null,
      created_at: new Date(),
    } as never)
  })

  it('marks notification as read', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications/notif-0001/read', {
      method: 'PATCH',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('read_at')
  })

  it('returns 404 when notification not found', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.notifications.findUnique).mockResolvedValueOnce(null)
    const app = buildApp()
    const res = await app.request('/api/notifications/nonexistent/read', {
      method: 'PATCH',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when notification belongs to different user', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.notifications.findUnique).mockResolvedValueOnce({
      id: 'notif-0001',
      user_id: 'other-user',
      org_id: 'org-notif-0001',
      type: 'run_complete',
      title: 'Run finished',
      body: null,
      action_url: null,
      read_at: null,
      created_at: new Date(),
    } as never)
    const app = buildApp()
    const res = await app.request('/api/notifications/notif-0001/read', {
      method: 'PATCH',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/notifications/mark-all-read', () => {
  it('returns success', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /api/notifications/preferences', () => {
  it('returns full preference matrix', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications/preferences', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.preferences)).toBe(true)
    const prefs = body.preferences as Array<Record<string, unknown>>
    // 8 types × 2 channels = 16 entries
    expect(prefs.length).toBe(16)
    // All default to true when no preference record
    expect(prefs.every((p) => p.enabled === true)).toBe(true)
  })
})

describe('PATCH /api/notifications/preferences', () => {
  it('updates preferences', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications/preferences', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        preferences: [
          { notification_type: 'run_complete', channel: 'email', enabled: false },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('returns 400 for invalid body', async () => {
    const app = buildApp()
    const res = await app.request('/api/notifications/preferences', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ preferences: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })
})
