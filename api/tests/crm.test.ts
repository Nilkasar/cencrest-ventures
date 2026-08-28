import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock db before any imports that use it
vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-crm-0001', email: 'crm@bebest.dev', name: 'CRM User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-crm-0001',
        name: 'CRM Org',
        slug: 'crm-org',
        created_at: new Date(),
        deleted_at: null,
        subscriptions: { plan: 'starter', status: 'active' },
        account_health: { health_score: 75, risk_level: 'healthy', calculated_at: new Date() },
        _count: { crm_contacts: 2, crm_notes: 3 },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'org-crm-0001',
          name: 'CRM Org',
          slug: 'crm-org',
          created_at: new Date(),
          subscriptions: { plan: 'starter', status: 'active' },
          account_health: { health_score: 75, risk_level: 'healthy', calculated_at: new Date() },
        },
      ]),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-crm-1', user_id: 'user-crm-0001', role: 'owner' }),
    },
    crm_notes: {
      create: vi.fn().mockResolvedValue({
        id: 'note-0001',
        org_id: 'org-crm-0001',
        author_id: 'user-crm-0001',
        content: 'A test note',
        created_at: new Date(),
        updated_at: new Date(),
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'note-0001',
          org_id: 'org-crm-0001',
          author_id: 'user-crm-0001',
          content: 'A test note',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]),
    },
    usage_records: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'ur-0001',
          organization_id: 'org-crm-0001',
          metric: 'prompt_runs',
          quantity: 1,
          recorded_at: new Date(),
        },
      ]),
    },
  },
}))

vi.mock('../src/lib/health-score.js', () => ({
  calculateHealthScore: vi.fn().mockResolvedValue({
    health_score: 75,
    prompt_runs_last_30d: 5,
    logins_last_7d: 3,
    actions_completed: 4,
    risk_level: 'healthy',
  }),
  recalculateAllHealthScores: vi.fn().mockResolvedValue(undefined),
}))

// Build a standalone test app that mounts the CRM router
async function buildApp() {
  const { default: crm } = await import('../src/routes/crm.js')
  const app = new Hono()
  app.route('/api/admin/crm', crm)
  return app
}

const authHeaders = { 'x-user-id': 'user-crm-0001', 'Content-Type': 'application/json' }

describe('GET /api/admin/crm/accounts', () => {
  it('returns paginated account list', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    const first = body[0] as Record<string, unknown>
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('slug')
    expect(first).toHaveProperty('plan')
    expect(first).toHaveProperty('health_score')
    expect(first).toHaveProperty('risk_level')
  })

  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/admin/crm/accounts/:orgId', () => {
  it('returns account detail', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('name')
    expect(body).toHaveProperty('crm_contacts_count')
    expect(body).toHaveProperty('crm_notes_count')
  })

  it('returns 404 when org not found', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(null as never)
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/nonexistent', { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/admin/crm/accounts/:orgId/notes', () => {
  it('creates a note', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001/notes', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'A test note' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.content).toBe('A test note')
  })

  it('returns 422 for missing content', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001/notes', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'A test note' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/admin/crm/accounts/:orgId/events', () => {
  it('returns timeline with notes and usage_records', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001/events', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.notes)).toBe(true)
    expect(Array.isArray(body.usage_records)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/crm/accounts/org-crm-0001/events')
    expect(res.status).toBe(401)
  })
})
