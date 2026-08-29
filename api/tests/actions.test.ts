import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-ac-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-ac-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-ac-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    actions: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'action-001', brand_id: 'brand-001', action_type: 'recommendation', title: 'Test Action', priority: 'high', status: 'pending', created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'action-001', status: 'completed' }),
      count: vi.fn().mockResolvedValue(0),
    },
    recommendations: { findMany: vi.fn().mockResolvedValue([]) },
    geo_gaps: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('../src/lib/action-center.js', () => ({
  syncActionsFromRecommendations: vi.fn().mockResolvedValue(3),
  syncActionsFromGeoGaps: vi.fn().mockResolvedValue(2),
  dismissAction: vi.fn().mockResolvedValue(undefined),
  completeAction: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-ac-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/actions'

async function buildApp() {
  const { default: actionsRoute } = await import('../src/routes/actions.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/actions', actionsRoute)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-ac-001', deleted_at: null,
  } as never)
}

async function withAction() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.actions.findFirst).mockResolvedValueOnce({
    id: 'action-001', brand_id: 'brand-001', status: 'pending', deleted_at: null,
  } as never)
}

describe('GET /actions', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with pagination shape', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.actions.count).mockResolvedValueOnce(5)
    vi.mocked(db.actions.findMany).mockResolvedValueOnce([
      { id: 'action-001', brand_id: 'brand-001', title: 'Test Action', priority: 'high', status: 'pending', created_at: new Date() },
    ] as never)
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(5)
  })
})

describe('POST /actions/sync', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/sync`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with synced count', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/sync`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('synced')
    expect(body.synced).toBe(5)
  })
})

describe('POST /actions', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action_type: 'manual', title: 'Do something' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 with id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action_type: 'manual', title: 'Do something' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('action-001')
  })
})

describe('PATCH /actions/:actionId', () => {
  it('returns 404 for unknown action', async () => {
    const app = await buildApp()
    await withBrand()
    // actions.findFirst returns null by default
    const res = await app.request(`${base}/no-such-action`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'in_progress' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 updated', async () => {
    const app = await buildApp()
    await withBrand()
    await withAction()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.actions.update).mockResolvedValueOnce({ id: 'action-001', status: 'in_progress' } as never)
    const res = await app.request(`${base}/action-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'in_progress' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.status).toBe('in_progress')
  })
})

describe('POST /actions/:actionId/dismiss', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/action-001/dismiss`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /actions/:actionId/complete', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/action-001/complete`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /actions/summary', () => {
  it('returns 200 with by_status and by_priority', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.actions.count)
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(5)  // pending
      .mockResolvedValueOnce(2)  // in_progress
      .mockResolvedValueOnce(2)  // completed
      .mockResolvedValueOnce(1)  // dismissed
      .mockResolvedValueOnce(3)  // critical
      .mockResolvedValueOnce(4)  // high
      .mockResolvedValueOnce(2)  // medium
      .mockResolvedValueOnce(1)  // low
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('by_status')
    expect(body).toHaveProperty('by_priority')
    const byStatus = body.by_status as Record<string, unknown>
    expect(byStatus).toHaveProperty('pending')
    expect(byStatus).toHaveProperty('in_progress')
    expect(byStatus).toHaveProperty('completed')
    expect(byStatus).toHaveProperty('dismissed')
    const byPriority = body.by_priority as Record<string, unknown>
    expect(byPriority).toHaveProperty('critical')
    expect(byPriority).toHaveProperty('high')
    expect(byPriority).toHaveProperty('medium')
    expect(byPriority).toHaveProperty('low')
    expect(body.total).toBe(10)
    expect(byStatus.pending).toBe(5)
    expect(byPriority.critical).toBe(3)
  })
})
