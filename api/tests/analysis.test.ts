import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-analysis-0001', email: 'analysis@bebest.dev', name: 'Analysis User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-analysis-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-analysis-1', user_id: 'user-analysis-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    prompt_runs: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    visibility_scores: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    mention_extractions: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    citations: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

vi.mock('../src/lib/analysis-pipeline.js', () => ({
  analyseRun: vi.fn().mockResolvedValue(undefined),
  extractMentions: vi.fn().mockReturnValue([]),
  extractCitations: vi.fn().mockReturnValue([]),
}))

const authHeaders = { 'x-user-id': 'user-analysis-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001'

async function makeApp() {
  const { default: analysisRouter } = await import('../src/routes/analysis.js')
  const testApp = new Hono()
  testApp.route('/api/orgs/:slug/brands/:brandId', analysisRouter)
  testApp.notFound((c) => c.json({ error: 'Not found' }, 404))
  return testApp
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-analysis-0001', name: 'Acme Brand', deleted_at: null,
  } as never)
}

describe('GET /visibility', () => {
  it('returns array', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.visibility_scores.findMany).mockResolvedValueOnce([
      {
        id: 'vs-1', brand_id: 'brand-0001', provider_name: 'openai', run_id: 'run-0001',
        score: 72, mention_rate: 0.8, avg_sentiment: 0.5, avg_position: null,
        calculated_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/visibility`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/visibility`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /visibility/history', () => {
  it('returns array', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.visibility_scores.findMany).mockResolvedValueOnce([
      {
        id: 'vs-2', brand_id: 'brand-0001', provider_name: 'anthropic', run_id: 'run-0001',
        score: 65, mention_rate: 0.6, avg_sentiment: 0.2, avg_position: null,
        calculated_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/visibility/history`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('supports ?provider= filter', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.visibility_scores.findMany).mockResolvedValueOnce([])
    const app = await makeApp()
    const res = await app.request(`${base}/visibility/history?provider=openai`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/visibility/history`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /mentions', () => {
  it('returns paginated result', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.mention_extractions.count).mockResolvedValueOnce(1)
    vi.mocked(db.mention_extractions.findMany).mockResolvedValueOnce([
      {
        id: 'me-1', response_id: 'resp-1', entity_name: 'Acme Brand', entity_type: 'brand',
        mention_count: 3, first_mention_pos: 42, sentiment: 'positive', sentiment_score: 0.8,
        is_recommended: true, created_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/mentions`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(1)
  })

  it('supports ?entity_type= and ?sentiment= filters', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.mention_extractions.count).mockResolvedValueOnce(0)
    vi.mocked(db.mention_extractions.findMany).mockResolvedValueOnce([])
    const app = await makeApp()
    const res = await app.request(`${base}/mentions?entity_type=brand&sentiment=positive`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.total).toBe(0)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/mentions`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /citations', () => {
  it('returns paginated result', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.citations.count).mockResolvedValueOnce(2)
    vi.mocked(db.citations.findMany).mockResolvedValueOnce([
      {
        id: 'cit-1', response_id: 'resp-1', url: 'https://example.com', domain: 'example.com',
        citation_type: 'link', context_snippet: 'as seen on example.com', created_at: new Date(),
      } as never,
      {
        id: 'cit-2', response_id: 'resp-1', url: null, domain: null,
        citation_type: 'named_source', context_snippet: 'according to Forbes', created_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/citations`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(2)
  })

  it('supports ?domain= filter', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.citations.count).mockResolvedValueOnce(0)
    vi.mocked(db.citations.findMany).mockResolvedValueOnce([])
    const app = await makeApp()
    const res = await app.request(`${base}/citations?domain=example.com`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.total).toBe(0)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/citations`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('GET /runs/:runId/analysis', () => {
  it('returns analysis object', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-0001', brand_id: 'brand-0001', status: 'complete',
    } as never)
    vi.mocked(db.visibility_scores.findMany).mockResolvedValueOnce([
      {
        id: 'vs-1', brand_id: 'brand-0001', provider_name: 'openai', run_id: 'run-0001',
        score: 72, mention_rate: 0.8, avg_sentiment: 0.5, avg_position: null, calculated_at: new Date(),
      } as never,
    ])
    vi.mocked(db.mention_extractions.findMany).mockResolvedValueOnce([
      {
        id: 'me-1', response_id: 'resp-1', entity_name: 'Acme', entity_type: 'brand',
        mention_count: 2, sentiment: 'positive', is_recommended: false, created_at: new Date(),
      } as never,
    ])
    vi.mocked(db.citations.findMany).mockResolvedValueOnce([
      {
        id: 'cit-1', response_id: 'resp-1', url: 'https://techcrunch.com/article',
        domain: 'techcrunch.com', citation_type: 'link', context_snippet: 'as seen on TC', created_at: new Date(),
      } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/runs/run-0001/analysis`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('run_id')
    expect(body).toHaveProperty('visibility_scores')
    expect(body).toHaveProperty('mention_summary')
    expect(body).toHaveProperty('top_cited_domains')
    expect(Array.isArray(body.visibility_scores)).toBe(true)
    expect(Array.isArray(body.mention_summary)).toBe(true)
    expect(Array.isArray(body.top_cited_domains)).toBe(true)
  })

  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/runs/run-0001/analysis`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown run', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/runs/no-such-run/analysis`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})
