import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-opp-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-opp-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-opp-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    opportunities: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'opp-1', brand_id: 'brand-0001', keyword_or_query: 'best crm', unified_score: 75 }),
      update: vi.fn().mockResolvedValue({ id: 'opp-1' }),
    },
  },
}))

vi.mock('../src/lib/opportunity-engine.js', () => ({
  recalculateOpportunities: vi.fn().mockResolvedValue(10),
}))

const authHeaders = { 'x-user-id': 'user-opp-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/opportunities'

async function buildApp() {
  const { default: opportunities } = await import('../src/routes/opportunities.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/opportunities', opportunities)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-opp-0001', deleted_at: null,
  } as never)
}

describe('GET /opportunities', () => {
  it('returns paginated list', async () => {
    const app = await buildApp()
    await withBrand()
    vi.mocked((await import('../src/lib/db.js')).db.opportunities.count).mockResolvedValueOnce(2)
    vi.mocked((await import('../src/lib/db.js')).db.opportunities.findMany).mockResolvedValueOnce([
      { id: 'opp-1', brand_id: 'brand-0001', keyword_or_query: 'best crm', unified_score: 75, priority_tier: 'P1' },
      { id: 'opp-2', brand_id: 'brand-0001', keyword_or_query: 'crm tools', unified_score: 45, priority_tier: 'P2' },
    ] as never)
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('filters by ?tier=P1', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.opportunities.count).mockResolvedValueOnce(1)
    vi.mocked(db.opportunities.findMany).mockResolvedValueOnce([
      { id: 'opp-1', brand_id: 'brand-0001', keyword_or_query: 'best crm', unified_score: 80, priority_tier: 'P1' },
    ] as never)
    const res = await app.request(`${base}?tier=P1`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('data')
    const data = body.data as Array<Record<string, unknown>>
    expect(data.every((o) => o.priority_tier === 'P1')).toBe(true)
  })
})

describe('GET /opportunities/summary', () => {
  it('returns tier counts and avg score', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.opportunities.count)
      .mockResolvedValueOnce(3)  // P1
      .mockResolvedValueOnce(5)  // P2
      .mockResolvedValueOnce(2)  // P3
    vi.mocked(db.opportunities.findMany).mockResolvedValueOnce([
      { unified_score: 80 },
      { unified_score: 60 },
      { unified_score: 45 },
    ] as never)
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('P1')
    expect(body).toHaveProperty('P2')
    expect(body).toHaveProperty('P3')
    expect(body).toHaveProperty('avgUnifiedScore')
    expect(body).toHaveProperty('totalOpportunities')
    expect(body.P1).toBe(3)
    expect(body.P2).toBe(5)
    expect(body.P3).toBe(2)
    expect(body.totalOpportunities).toBe(10)
  })
})

describe('GET /opportunities/:opportunityId', () => {
  it('returns opportunity detail', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.opportunities.findFirst).mockResolvedValueOnce({
      id: 'opp-1', brand_id: 'brand-0001', keyword_or_query: 'best crm',
      seo_gap_score: 80, geo_gap_score: 100, unified_score: 90, priority_tier: 'P1',
    } as never)
    const res = await app.request(`${base}/opp-1`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('opp-1')
  })

  it('returns 404 for unknown opportunity id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/no-such-id`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('POST /opportunities/recalculate', () => {
  it('returns 202 immediately', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/recalculate`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('recalculated')
  })
})
