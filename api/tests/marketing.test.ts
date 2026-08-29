import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-mkt-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-mkt-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-mkt-001', role: 'owner' }) },
    marketing_campaigns: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'camp-001', org_id: 'org-mkt-001', name: 'Test Campaign', campaign_type: 'content', status: 'draft', metrics: {}, channels: [], target_audience: {}, created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'camp-001', status: 'active' }),
    },
    growth_levers: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'lever-001', org_id: 'org-mkt-001', lever_type: 'seo', title: 'Improve rankings', status: 'identified' }),
      update: vi.fn().mockResolvedValue({ id: 'lever-001', status: 'active' }),
    },
  },
}))

const authHeaders = { 'x-user-id': 'user-mkt-001', 'Content-Type': 'application/json' }
const BASE = '/api/orgs/acme/marketing'

async function buildApp() {
  const { default: marketing } = await import('../src/routes/marketing.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/marketing', marketing)
  return app
}

async function withCampaign() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.marketing_campaigns.findFirst).mockResolvedValueOnce({
    id: 'camp-001',
    org_id: 'org-mkt-001',
    name: 'Test',
    status: 'draft',
    metrics: {},
    deleted_at: null,
  } as never)
}

async function withLever() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.growth_levers.findFirst).mockResolvedValueOnce({
    id: 'lever-001',
    org_id: 'org-mkt-001',
    status: 'identified',
    deleted_at: null,
  } as never)
}

describe('GET /marketing/campaigns', () => {
  it('returns 200 with array', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /marketing/campaigns', () => {
  it('returns 201 with id', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Test Campaign', campaign_type: 'content' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'camp-001')
  })
})

describe('GET /marketing/campaigns/:id', () => {
  it('returns 404 for unknown campaign', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/unknown-id`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with campaign data', async () => {
    await withCampaign()
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/camp-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'camp-001')
  })
})

describe('PATCH /marketing/campaigns/:id', () => {
  it('returns 404 for unknown campaign', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/unknown-id`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 with updated campaign', async () => {
    await withCampaign()
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/camp-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'camp-001')
  })
})

describe('DELETE /marketing/campaigns/:id', () => {
  it('returns 200 success', async () => {
    await withCampaign()
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/camp-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /marketing/campaigns/:id/metrics', () => {
  it('returns 200 with updated metrics', async () => {
    await withCampaign()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.marketing_campaigns.update).mockResolvedValueOnce({
      id: 'camp-001',
      metrics: { impressions: 1000, clicks: 50 },
    } as never)
    const app = await buildApp()
    const res = await app.request(`${BASE}/campaigns/camp-001/metrics`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ metrics: { impressions: 1000, clicks: 50 } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'camp-001')
  })
})

describe('GET /marketing/levers', () => {
  it('returns 200 with array', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/levers`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /marketing/levers', () => {
  it('returns 201 with id', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/levers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ lever_type: 'seo', title: 'Improve rankings' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'lever-001')
  })
})

describe('PATCH /marketing/levers/:id', () => {
  it('returns 404 for unknown lever', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/levers/unknown-id`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 with updated lever', async () => {
    await withLever()
    const app = await buildApp()
    const res = await app.request(`${BASE}/levers/lever-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'lever-001')
  })
})

describe('GET /marketing/summary', () => {
  it('returns 200 with campaigns and levers counts', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('campaigns')
    expect(body).toHaveProperty('levers')
    const camps = body.campaigns as Record<string, unknown>
    const lvrs = body.levers as Record<string, unknown>
    expect(camps).toHaveProperty('total')
    expect(camps).toHaveProperty('by_status')
    expect(lvrs).toHaveProperty('total')
    expect(lvrs).toHaveProperty('by_status')
  })
})
