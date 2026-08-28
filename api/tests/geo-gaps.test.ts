import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-geo-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-geo-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-geo-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    geo_gaps: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({ id: 'gap-1' }),
    },
  },
}))

vi.mock('../src/lib/geo-gap-engine.js', () => ({
  computeGeoGaps: vi.fn().mockResolvedValue(5),
}))

const authHeaders = { 'x-user-id': 'user-geo-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/geo-gaps'

async function buildApp() {
  const { default: geoGaps } = await import('../src/routes/geo-gaps.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/geo-gaps', geoGaps)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-geo-0001', deleted_at: null,
  } as never)
}

describe('GET /geo-gaps', () => {
  it('returns paginated active gaps', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.geo_gaps.count).mockResolvedValueOnce(2)
    vi.mocked(db.geo_gaps.findMany).mockResolvedValueOnce([
      {
        id: 'gap-1', brand_id: 'brand-0001', query_id: 'q-1', provider_name: 'openai',
        gap_type: 'no_mention', severity: 'critical', business_impact_score: 500,
        dismissed_at: null, created_at: new Date(), updated_at: new Date(),
        root_cause_hypothesis: 'Brand has no content', recommended_action: 'Create content',
        buyer_journeys: { query: 'best crm software', stage: 'consideration', intent_type: 'commercial' },
      },
      {
        id: 'gap-2', brand_id: 'brand-0001', query_id: 'q-2', provider_name: 'google',
        gap_type: 'no_citation', severity: 'medium', business_impact_score: 100,
        dismissed_at: null, created_at: new Date(), updated_at: new Date(),
        root_cause_hypothesis: 'No citations', recommended_action: 'Build citations',
        buyer_journeys: { query: 'crm tool review', stage: 'awareness', intent_type: 'informational' },
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
    const data = body.data as Array<Record<string, unknown>>
    expect(data[0]).toHaveProperty('query')
    expect(data[0]).toHaveProperty('stage')
  })

  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    // brands.findFirst already returns null by default
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /geo-gaps/summary', () => {
  it('returns counts by type and severity', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.geo_gaps.count)
      .mockResolvedValueOnce(3)  // no_mention
      .mockResolvedValueOnce(1)  // low_sentiment
      .mockResolvedValueOnce(2)  // no_citation
      .mockResolvedValueOnce(1)  // competitor_only
      .mockResolvedValueOnce(2)  // critical
      .mockResolvedValueOnce(2)  // high
      .mockResolvedValueOnce(2)  // medium
      .mockResolvedValueOnce(1)  // low
      .mockResolvedValueOnce(7)  // total
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('byType')
    expect(body).toHaveProperty('bySeverity')
    expect(body).toHaveProperty('total')
    const byType = body.byType as Record<string, unknown>
    expect(byType).toHaveProperty('no_mention')
    expect(byType).toHaveProperty('low_sentiment')
    expect(byType).toHaveProperty('no_citation')
    expect(byType).toHaveProperty('competitor_only')
    const bySeverity = body.bySeverity as Record<string, unknown>
    expect(bySeverity).toHaveProperty('critical')
    expect(bySeverity).toHaveProperty('high')
    expect(bySeverity).toHaveProperty('medium')
    expect(bySeverity).toHaveProperty('low')
    expect(byType.no_mention).toBe(3)
    expect(body.total).toBe(7)
  })
})

describe('GET /geo-gaps/:gapId', () => {
  it('returns gap detail', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.geo_gaps.findFirst).mockResolvedValueOnce({
      id: 'gap-1', brand_id: 'brand-0001', query_id: 'q-1', provider_name: 'openai',
      gap_type: 'no_mention', severity: 'critical', business_impact_score: 500,
      dismissed_at: null, created_at: new Date(), updated_at: new Date(),
      root_cause_hypothesis: 'Brand has no content', recommended_action: 'Create content',
      buyer_journeys: { query: 'best crm software', stage: 'consideration', intent_type: 'commercial' },
    } as never)
    const res = await app.request(`${base}/gap-1`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('gap-1')
    expect(body).toHaveProperty('query')
    expect(body).toHaveProperty('stage')
    expect(body.gap_type).toBe('no_mention')
    expect(body.severity).toBe('critical')
  })

  it('returns 404 for unknown gap', async () => {
    const app = await buildApp()
    await withBrand()
    // geo_gaps.findFirst already returns null by default
    const res = await app.request(`${base}/no-such-gap`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('POST /geo-gaps/dismiss/:gapId', () => {
  it('dismisses a gap', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.geo_gaps.findFirst).mockResolvedValueOnce({
      id: 'gap-1', brand_id: 'brand-0001', dismissed_at: null,
    } as never)
    const res = await app.request(`${base}/dismiss/gap-1`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('returns 404 for unknown gap', async () => {
    const app = await buildApp()
    await withBrand()
    // geo_gaps.findFirst returns null by default
    const res = await app.request(`${base}/dismiss/no-such-gap`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })
})
