import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-cs-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-cs-001', name: 'Acme', slug: 'admin', deleted_at: null, created_at: new Date() }),
      findMany: vi.fn().mockResolvedValue([{ id: 'org-cs-001' }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'org-cs-001', name: 'Acme' }),
    },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-cs-001', role: 'owner' }) },
    customer_health_checks: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'hc-001', org_id: 'org-cs-001', health_score: 75, churn_risk: 'low' }),
      update: vi.fn().mockResolvedValue({ id: 'hc-001' }),
    },
    account_health: { findFirst: vi.fn().mockResolvedValue({ health_score: 80 }) },
    runs: { findFirst: vi.fn().mockResolvedValue(null) },
    actions: { count: vi.fn().mockResolvedValue(5) },
    learning_signals: { count: vi.fn().mockResolvedValue(10) },
    brands: { findMany: vi.fn().mockResolvedValue([]) },
    recommendations: { count: vi.fn().mockResolvedValue(0) },
  },
}))

vi.mock('../src/lib/customer-success.js', () => ({
  computeHealthCheck: vi.fn().mockResolvedValue({ id: 'hc-001', org_id: 'org-cs-001', health_score: 75, churn_risk: 'low' }),
  runInterventions: vi.fn().mockResolvedValue(undefined),
  getAllHealthChecks: vi.fn().mockResolvedValue([]),
}))

vi.mock('../src/lib/notify.js', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-cs-001', 'Content-Type': 'application/json' }
const base = '/api/admin/customer-success'

async function buildApp() {
  const { default: customerSuccess } = await import('../src/routes/customer-success.js')
  const app = new Hono()
  app.route('/api/admin/customer-success', customerSuccess)
  return app
}

describe('GET /api/admin/customer-success', () => {
  it('returns 200 with array', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/admin/customer-success/compute/:orgId', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/compute/org-cs-001`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /api/admin/customer-success/compute-all', () => {
  it('returns 202 with count', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/compute-all`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(typeof body.queued).toBe('number')
    expect(body.queued).toBe(1)
  })
})

describe('POST /api/admin/customer-success/intervene/:orgId', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/intervene/org-cs-001`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('GET /api/admin/customer-success/summary', () => {
  it('returns 200 with summary shape', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('avg_health_score')
    expect(body).toHaveProperty('by_churn_risk')
  })
})

describe('GET /api/admin/customer-success/:orgId', () => {
  it('returns 404 when not found', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/no-such-org`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with data when found', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.customer_health_checks.findFirst).mockResolvedValueOnce({
      id: 'hc-001', org_id: 'org-cs-001', health_score: 75, churn_risk: 'low',
    } as never)
    const app = await buildApp()
    const res = await app.request(`${base}/org-cs-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('health_score')
  })
})
