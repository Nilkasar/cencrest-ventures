import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-rec-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-rec-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-rec-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    recommendations: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      update: vi.fn().mockResolvedValue({ id: 'rec-1', status: 'dismissed' }),
    },
  },
}))

vi.mock('../src/lib/recommendation-engine.js', () => ({
  generateRecommendations: vi.fn().mockResolvedValue(5),
}))

const authHeaders = { 'x-user-id': 'user-rec-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/recommendations'

async function buildApp() {
  const { default: recommendations } = await import('../src/routes/recommendations.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/recommendations', recommendations)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-rec-0001', deleted_at: null,
  } as never)
}

describe('GET /recommendations', () => {
  it('returns active recommendations list', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.recommendations.count).mockResolvedValueOnce(2)
    vi.mocked(db.recommendations.findMany).mockResolvedValueOnce([
      {
        id: 'rec-1', brand_id: 'brand-0001', rec_type: 'create_content',
        title: 'Create content targeting: best crm', status: 'active',
        effort_estimate: 'high', roi_score: 100, created_at: new Date(),
      },
      {
        id: 'rec-2', brand_id: 'brand-0001', rec_type: 'build_citation',
        title: 'Build citations for: crm tools', status: 'active',
        effort_estimate: 'low', roi_score: 200, created_at: new Date(),
      },
    ] as never)
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(2)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    // brands.findFirst returns null by default
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /recommendations/summary', () => {
  it('returns counts by type and status', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.recommendations.count)
      .mockResolvedValueOnce(3)  // create_content
      .mockResolvedValueOnce(2)  // optimize_page
      .mockResolvedValueOnce(1)  // build_citation
      .mockResolvedValueOnce(1)  // earn_link
      .mockResolvedValueOnce(0)  // improve_entity
      .mockResolvedValueOnce(0)  // update_schema
      .mockResolvedValueOnce(5)  // active
      .mockResolvedValueOnce(2)  // dismissed
      .mockResolvedValueOnce(0)  // snoozed
      .mockResolvedValueOnce(1)  // completed
    vi.mocked(db.recommendations.findMany).mockResolvedValueOnce([
      { roi_score: 100 },
      { roi_score: 200 },
      { roi_score: 150 },
    ] as never)
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('byType')
    expect(body).toHaveProperty('byStatus')
    expect(body).toHaveProperty('totalActive')
    expect(body).toHaveProperty('avgRoiScore')
    const byType = body.byType as Record<string, unknown>
    expect(byType).toHaveProperty('create_content')
    expect(byType).toHaveProperty('optimize_page')
    expect(byType).toHaveProperty('build_citation')
    expect(byType).toHaveProperty('earn_link')
    expect(byType).toHaveProperty('improve_entity')
    expect(byType).toHaveProperty('update_schema')
    const byStatus = body.byStatus as Record<string, unknown>
    expect(byStatus).toHaveProperty('active')
    expect(byStatus).toHaveProperty('dismissed')
    expect(byStatus).toHaveProperty('snoozed')
    expect(byStatus).toHaveProperty('completed')
    expect(body.totalActive).toBe(5)
    expect(byType.create_content).toBe(3)
  })
})

describe('GET /recommendations/:recId', () => {
  it('returns recommendation detail', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.recommendations.findFirst).mockResolvedValueOnce({
      id: 'rec-1', brand_id: 'brand-0001', rec_type: 'create_content',
      title: 'Create content targeting: best crm', status: 'active',
      effort_estimate: 'high', roi_score: 100, rationale: 'Brand has no presence',
      created_at: new Date(), updated_at: new Date(),
    } as never)
    const res = await app.request(`${base}/rec-1`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('rec-1')
    expect(body.rec_type).toBe('create_content')
    expect(body.status).toBe('active')
  })

  it('returns 404 for unknown recommendation', async () => {
    const app = await buildApp()
    await withBrand()
    // recommendations.findFirst returns null by default
    const res = await app.request(`${base}/no-such-rec`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /recommendations/:recId', () => {
  it('dismisses a recommendation', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.recommendations.findFirst).mockResolvedValueOnce({
      id: 'rec-1', brand_id: 'brand-0001', status: 'active',
    } as never)
    vi.mocked(db.recommendations.update).mockResolvedValueOnce({
      id: 'rec-1', brand_id: 'brand-0001', status: 'dismissed',
    } as never)
    const res = await app.request(`${base}/rec-1`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'dismissed' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('dismissed')
  })
})

describe('POST /recommendations/generate', () => {
  it('returns 202 immediately', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/generate`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('message')
    expect(body.message).toBe('Generating recommendations')
  })
})
