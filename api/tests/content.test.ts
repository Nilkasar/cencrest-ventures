import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-ct-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-ct-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-ct-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    pages: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    content_analyses: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'ca-1', page_id: 'page-001', brand_id: 'brand-001', ai_readiness_score: 75, thin_content_flag: false, topic_coverage_score: 60, structured_data_present: true, word_count: 500, reading_level: 'intermediate', entity_density: 0.03, citations_found_in_ai_responses: 2, gap_types: [], improvement_suggestions: [], analyzed_at: new Date() }) },
    ai_responses: { count: vi.fn().mockResolvedValue(0) },
  },
}))

vi.mock('../src/lib/content-intelligence.js', async () => {
  const actual = await vi.importActual('../src/lib/content-intelligence.js') as Record<string, unknown>
  return {
    ...actual,
    analyzeContent: vi.fn().mockResolvedValue({
      id: 'ca-1',
      page_id: 'page-001',
      brand_id: 'brand-001',
      ai_readiness_score: 75,
      thin_content_flag: false,
      topic_coverage_score: 60,
      structured_data_present: true,
      word_count: 500,
      reading_level: 'intermediate',
      entity_density: 0.03,
      citations_found_in_ai_responses: 2,
      gap_types: [],
      improvement_suggestions: [],
      analyzed_at: new Date(),
    }),
    getContentGaps: vi.fn().mockResolvedValue({
      total_pages: 5,
      thin_pages: 2,
      low_readiness_pages: 3,
      no_structured_data_pages: 1,
      avg_ai_readiness_score: 55,
      pages_needing_improvement: [],
    }),
    getContentImprovements: vi.fn().mockResolvedValue([
      { type: 'thin_content', priority: 'P1', suggestion: 'Expand content', affected_pages_count: 2 },
    ]),
  }
})

const authHeaders = { 'x-user-id': 'user-ct-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/content'

async function buildApp() {
  const { default: contentRouter } = await import('../src/routes/content.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/content', contentRouter)
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-ct-001', name: 'Test Brand', deleted_at: null,
  } as never)
}

describe('GET /content', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with pagination shape', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.pages.count).mockResolvedValueOnce(0)
    vi.mocked(db.pages.findMany).mockResolvedValueOnce([])
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('GET /content/:pageId', () => {
  it('returns 404 for unknown page', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/no-such-page`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with page and analysis', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.pages.findFirst).mockResolvedValueOnce({
      id: 'page-001',
      brand_id: 'brand-001',
      url: 'https://acme.com/page',
      title: 'Test Page',
      content_analyses: {
        id: 'ca-1',
        ai_readiness_score: 75,
        thin_content_flag: false,
      },
    } as never)
    const res = await app.request(`${base}/page-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'page-001')
    expect(body).toHaveProperty('content_analyses')
  })
})

describe('POST /content/:pageId/analyze', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/page-001/analyze`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /content/analyze-all', () => {
  it('returns 202 with count', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.pages.findMany).mockResolvedValueOnce([
      { id: 'page-001' } as never,
      { id: 'page-002' } as never,
    ])
    const res = await app.request(`${base}/analyze-all`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('queued', 2)
  })
})

describe('GET /content/gaps', () => {
  it('returns 200 with gap summary shape', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total_pages')
    expect(body).toHaveProperty('thin_pages')
    expect(body).toHaveProperty('low_readiness_pages')
    expect(body).toHaveProperty('no_structured_data_pages')
    expect(body).toHaveProperty('avg_ai_readiness_score')
    expect(body).toHaveProperty('pages_needing_improvement')
  })

  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /content/improvements', () => {
  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/improvements`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    const first = body[0] as Record<string, unknown>
    expect(first).toHaveProperty('type')
    expect(first).toHaveProperty('priority')
    expect(first).toHaveProperty('suggestion')
    expect(first).toHaveProperty('affected_pages_count')
  })
})

describe('GET /content/export', () => {
  it('returns CSV by default', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.content_analyses.findMany).mockResolvedValueOnce([
      {
        id: 'ca-1', page_id: 'page-001', brand_id: 'brand-001',
        ai_readiness_score: 75, thin_content_flag: false,
        topic_coverage_score: 60, structured_data_present: true,
        word_count: 500, reading_level: 'intermediate', entity_density: 0.03,
        citations_found_in_ai_responses: 2, gap_types: [], improvement_suggestions: [],
        analyzed_at: new Date(), pages: { url: 'https://acme.com' },
      } as never,
    ])
    const res = await app.request(`${base}/export`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const text = await res.text()
    expect(text).toContain('page_id')
    expect(text).toContain('word_count')
  })

  it('returns JSON with format=json', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.content_analyses.findMany).mockResolvedValueOnce([])
    const res = await app.request(`${base}/export?format=json`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})
