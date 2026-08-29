import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-lrn-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-lrn-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-lrn-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    learning_signals: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'sig-001', brand_id: 'brand-001', signal_type: 'visibility', processed: false }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    learning_insights: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'ins-001', brand_id: 'brand-001', insight_type: 'visibility', title: 'Score improving' }),
      update: vi.fn().mockResolvedValue({ id: 'ins-001', action_taken: true }),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

vi.mock('../src/lib/learning-loop.js', () => ({
  recordSignal: vi.fn().mockResolvedValue(undefined),
  processSignals: vi.fn().mockResolvedValue(5),
  getInsights: vi.fn().mockResolvedValue([]),
  markInsightActioned: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-lrn-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/learning'

async function buildApp() {
  const { default: learningRoute } = await import('../src/routes/learning.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/learning', learningRoute)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-lrn-001', deleted_at: null,
  } as never)
}

describe('POST /learning/signals', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/signals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ signal_type: 'visibility', source: 'scan', metric_name: 'score', metric_value: 75 }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 recorded', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/signals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ signal_type: 'visibility', source: 'scan', metric_name: 'score', metric_value: 75 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.recorded).toBe(true)
  })
})

describe('POST /learning/process', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/process`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns 202 queued', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/process`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('GET /learning/signals', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/signals`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/signals`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /learning/insights', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/insights`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/insights`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /learning/insights/:id/action', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/insights/ins-001/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action_type: 'content_update' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /learning/summary', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with counts', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total_signals')
    expect(body).toHaveProperty('unprocessed_signals')
    expect(body).toHaveProperty('total_insights')
    expect(body).toHaveProperty('actioned_insights')
  })
})
