import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-comp-0001', email: 'comp@bebest.dev', name: 'Comp User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-comp-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-comp-1', user_id: 'user-comp-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    share_of_voice: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    visibility_scores: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    competitors: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    competitor_visibility: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    keywords: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('../src/lib/competitive-analysis.js', () => ({
  computeCompetitorVisibility: vi.fn().mockResolvedValue(undefined),
  computeShareOfVoice: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-comp-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/competitive'

async function makeApp() {
  const { default: competitiveRouter } = await import('../src/routes/competitive.js')
  const testApp = new Hono()
  testApp.route('/api/orgs/:slug/brands/:brandId/competitive', competitiveRouter)
  testApp.notFound((c) => c.json({ error: 'Not found' }, 404))
  return testApp
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-comp-0001', name: 'Acme Brand', deleted_at: null,
  } as never)
}

describe('GET /competitive/sov', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/sov`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns empty SOV when no data', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/sov`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('entities')
    expect(Array.isArray(body.entities)).toBe(true)
    expect(body.run_id).toBeNull()
  })

  it('returns SOV matrix with data', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    const calcAt = new Date()
    vi.mocked(db.share_of_voice.findFirst).mockResolvedValueOnce({
      id: 'sov-1', brand_id: 'brand-0001', run_id: 'run-0001',
      query_id: 'q-1', entity_name: 'Acme Brand', entity_type: 'brand',
      sov_pct: 60, mentions: 12, calculated_at: calcAt,
    } as never)
    vi.mocked(db.share_of_voice.findMany).mockResolvedValueOnce([
      {
        id: 'sov-1', brand_id: 'brand-0001', run_id: 'run-0001',
        query_id: 'q-1', entity_name: 'Acme Brand', entity_type: 'brand',
        sov_pct: 60, mentions: 12, calculated_at: calcAt,
      },
      {
        id: 'sov-2', brand_id: 'brand-0001', run_id: 'run-0001',
        query_id: 'q-1', entity_name: 'Rival Co', entity_type: 'competitor',
        sov_pct: 40, mentions: 8, calculated_at: calcAt,
      },
    ] as never[])
    const app = await makeApp()
    const res = await app.request(`${base}/sov`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.run_id).toBe('run-0001')
    expect(Array.isArray(body.entities)).toBe(true)
    expect((body.entities as unknown[]).length).toBe(2)
  })
})

describe('GET /competitive/gaps', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns empty array when no SOV data', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  it('returns gap list when competitor SOV > 0 and brand SOV = 0', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    const calcAt = new Date()
    vi.mocked(db.share_of_voice.findFirst).mockResolvedValueOnce({
      id: 'sov-3', brand_id: 'brand-0001', run_id: 'run-0001',
      query_id: 'q-2', entity_name: 'Rival Co', entity_type: 'competitor',
      sov_pct: 100, mentions: 5, calculated_at: calcAt,
    } as never)
    vi.mocked(db.share_of_voice.findMany).mockResolvedValueOnce([
      {
        id: 'sov-3', brand_id: 'brand-0001', run_id: 'run-0001',
        query_id: 'q-2', entity_name: 'Rival Co', entity_type: 'competitor',
        sov_pct: 100, mentions: 5, calculated_at: calcAt,
        buyer_journeys: { stage: 'awareness' },
      },
    ] as never[])
    const app = await makeApp()
    const res = await app.request(`${base}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(body[0]).toHaveProperty('competitor_name', 'Rival Co')
    expect(body[0]).toHaveProperty('competitor_sov')
    expect(body[0]).toHaveProperty('stage', 'awareness')
  })
})

describe('GET /competitive/scores', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/scores`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns brand and competitor scores', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.visibility_scores.findMany).mockResolvedValueOnce([
      {
        id: 'vs-1', brand_id: 'brand-0001', provider_name: 'openai', run_id: 'run-0001',
        score: 72, mention_rate: 0.8, avg_sentiment: 0.5, avg_position: null,
        calculated_at: new Date(),
      } as never,
    ])
    vi.mocked(db.competitors.findMany).mockResolvedValueOnce([
      { id: 'comp-1', brand_id: 'brand-0001', name: 'Rival Co', deleted_at: null } as never,
    ])
    vi.mocked(db.competitor_visibility.findMany).mockResolvedValueOnce([
      {
        id: 'cv-1', competitor_id: 'comp-1', provider_name: 'openai', run_id: 'run-0001',
        score: 45, mention_rate: 0.5, avg_sentiment: 0.2, calculated_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/scores`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('brand')
    expect(body).toHaveProperty('competitors')
    expect(Array.isArray(body.brand)).toBe(true)
    expect(Array.isArray(body.competitors)).toBe(true)
    const competitors = body.competitors as Array<Record<string, unknown>>
    expect(competitors.length).toBe(1)
    expect(competitors[0]).toHaveProperty('name', 'Rival Co')
    expect(competitors[0]).toHaveProperty('scores')
  })
})

describe('GET /competitive/trends', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/trends`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns historical SOV per competitor', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.share_of_voice.findMany).mockResolvedValueOnce([
      {
        id: 'sov-4', brand_id: 'brand-0001', run_id: 'run-0001',
        query_id: 'q-1', entity_name: 'Rival Co', entity_type: 'competitor',
        sov_pct: 40, mentions: 8, calculated_at: new Date('2024-01-01'),
      },
      {
        id: 'sov-5', brand_id: 'brand-0001', run_id: 'run-0002',
        query_id: 'q-1', entity_name: 'Rival Co', entity_type: 'competitor',
        sov_pct: 50, mentions: 10, calculated_at: new Date('2024-01-08'),
      },
    ] as never[])
    const app = await makeApp()
    const res = await app.request(`${base}/trends`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(body[0]).toHaveProperty('competitor_name', 'Rival Co')
    expect(body[0]).toHaveProperty('history')
    expect(Array.isArray(body[0].history)).toBe(true)
    expect((body[0].history as unknown[]).length).toBe(2)
  })

  it('returns empty array when no competitor SOV data', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/trends`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })
})

describe('GET /competitive/seo-overlap', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/seo-overlap`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns paginated keyword list', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.keywords.count).mockResolvedValueOnce(2)
    vi.mocked(db.keywords.findMany).mockResolvedValueOnce([
      {
        id: 'kw-1', brand_id: 'brand-0001', keyword: 'best crm software',
        volume: 5000, difficulty: 65, intent: 'commercial', source: 'manual',
        created_at: new Date(), updated_at: new Date(),
        brand_keyword_rankings: [],
      },
      {
        id: 'kw-2', brand_id: 'brand-0001', keyword: 'crm for startups',
        volume: 1200, difficulty: 40, intent: 'informational', source: 'gsc',
        created_at: new Date(), updated_at: new Date(),
        brand_keyword_rankings: [
          { id: 'r-1', keyword_id: 'kw-2', brand_id: 'brand-0001', position: 25, date: new Date() },
        ],
      },
    ] as never[])
    const app = await makeApp()
    const res = await app.request(`${base}/seo-overlap`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total', 2)
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    const data = body.data as Array<Record<string, unknown>>
    expect(data.length).toBe(2)
    // kw-1 has no ranking → potential competitor advantage
    expect(data[0]).toHaveProperty('is_potential_competitor_advantage', true)
    expect(data[0]).toHaveProperty('current_position', null)
    // kw-2 has position 25 (> 20) → also potential gap
    expect(data[1]).toHaveProperty('is_potential_competitor_advantage', true)
    expect(data[1]).toHaveProperty('current_position', 25)
  })

  it('returns empty list when no keywords', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/seo-overlap`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.total).toBe(0)
    expect(Array.isArray(body.data)).toBe(true)
  })
})
