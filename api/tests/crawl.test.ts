import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-crawl-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-crawl-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-crawl-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    crawl_jobs: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'job-1', brand_id: 'brand-0001', status: 'pending', pages_crawled: 0, pages_found: 0 }),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    pages: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'page-1' }),
      count: vi.fn().mockResolvedValue(0),
    },
    page_issues: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('../src/lib/crawler.js', () => ({
  runCrawl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/lib/meta-fetch.js', () => ({
  validateDomain: vi.fn().mockReturnValue('acme.com'),
  fetchSiteMeta: vi.fn().mockResolvedValue({ name: null, description: null, logoUrl: null }),
}))

const authHeaders = { 'x-user-id': 'user-crawl-0001', 'Content-Type': 'application/json' }

describe('POST /api/orgs/:slug/brands/:brandId/crawl', () => {
  it('returns 404 when brand not found', async () => {
    const res = await app.request('/api/orgs/acme/brands/no-brand/crawl', {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns 422 when brand has no website', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-crawl-0001', website_url: null, deleted_at: null,
    } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl', {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(422)
  })

  it('creates a crawl job and returns 202', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-crawl-0001', website_url: 'https://acme.com', deleted_at: null,
    } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl', {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.status).toBe('pending')
  })

  it('returns 409 when crawl already running', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-crawl-0001', website_url: 'https://acme.com', deleted_at: null,
    } as never)
    vi.mocked(db.crawl_jobs.findFirst).mockResolvedValueOnce({ id: 'job-existing', status: 'running' } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl', {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/orgs/:slug/brands/:brandId/crawl/status', () => {
  it('returns never_crawled when no jobs', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-0001', organization_id: 'org-crawl-0001', deleted_at: null } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl/status', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('never_crawled')
  })
})

describe('GET /api/orgs/:slug/brands/:brandId/crawl/site-health', () => {
  it('returns health summary', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-0001', organization_id: 'org-crawl-0001', deleted_at: null } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl/site-health', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('score')
    expect(body).toHaveProperty('pageCount')
    expect(body).toHaveProperty('issues')
  })
})

describe('GET /api/orgs/:slug/brands/:brandId/crawl/issues', () => {
  it('returns paginated issues', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-0001', organization_id: 'org-crawl-0001', deleted_at: null } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl/issues', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('GET /api/orgs/:slug/brands/:brandId/crawl/pages', () => {
  it('returns paginated pages', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-0001', organization_id: 'org-crawl-0001', deleted_at: null } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001/crawl/pages', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.data)).toBe(true)
  })
})
