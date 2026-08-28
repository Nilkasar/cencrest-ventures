import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

const ORG_ID = 'org-brands-0001'
const BRAND_ID = 'brand-0001'
const USER_ID = 'user-brands-0001'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-brands-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-brands-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-brands-0001', role: 'owner' }),
    },
    brands: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'brand-0001', organization_id: 'org-brands-0001', name: 'Acme Brand',
        description: null, website_url: null, industry: null, positioning: null,
        value_proposition: null, key_differentiators: [], logo_url: null,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      }),
      update: vi.fn().mockResolvedValue({ id: 'brand-0001', name: 'Updated Brand' }),
    },
    products: {
      create: vi.fn().mockResolvedValue({ id: 'prod-1', brand_id: 'brand-0001', name: 'Product A' }),
    },
    competitors: {
      create: vi.fn().mockResolvedValue({ id: 'comp-1', brand_id: 'brand-0001', name: 'Rival Co' }),
    },
  },
}))

vi.mock('../src/lib/meta-fetch.js', () => ({
  validateDomain: vi.fn().mockReturnValue(null),
  fetchSiteMeta: vi.fn().mockResolvedValue({ name: null, description: null, logoUrl: null }),
}))

const authHeaders = { 'x-user-id': 'user-brands-0001', 'Content-Type': 'application/json' }

describe('GET /api/orgs/:slug/brands', () => {
  it('returns empty list', async () => {
    const res = await app.request('/api/orgs/acme/brands', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/orgs/acme/brands')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/orgs/:slug/brands', () => {
  it('creates a brand', async () => {
    const res = await app.request('/api/orgs/acme/brands', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Acme Brand' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.name).toBe('Acme Brand')
  })

  it('returns 422 for missing name', async () => {
    const res = await app.request('/api/orgs/acme/brands', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ description: 'no name' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/orgs/:slug/brands/:brandId', () => {
  it('returns 404 when brand not found', async () => {
    const res = await app.request('/api/orgs/acme/brands/nonexistent', {
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns brand with completeness', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-brands-0001', name: 'Acme Brand',
      description: 'A great brand', website_url: null, industry: null,
      positioning: null, value_proposition: null, key_differentiators: [],
      logo_url: null, aliases: [], created_at: new Date(), updated_at: new Date(), deleted_at: null,
      products: [], competitors: [],
    } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('completeness')
    expect(typeof body.completeness).toBe('number')
  })
})

describe('PATCH /api/orgs/:slug/brands/:brandId', () => {
  it('returns 404 when brand not found', async () => {
    const res = await app.request('/api/orgs/acme/brands/nonexistent', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(res.status).toBe(404)
  })

  it('updates brand', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-brands-0001', name: 'Acme Brand',
      website_url: null, logo_url: null, deleted_at: null,
    } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Updated Brand' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/orgs/:slug/brands/:brandId', () => {
  it('returns 404 when brand not found', async () => {
    const res = await app.request('/api/orgs/acme/brands/nonexistent', {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('soft-deletes brand', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-brands-0001', deleted_at: null,
    } as never)
    const res = await app.request('/api/orgs/acme/brands/brand-0001', {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /api/orgs/:slug/brands/:brandId/products', () => {
  beforeEach(async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValue({
      id: 'brand-0001', organization_id: 'org-brands-0001', deleted_at: null,
    } as never)
  })

  it('creates a product', async () => {
    const res = await app.request('/api/orgs/acme/brands/brand-0001/products', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Product A' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('POST /api/orgs/:slug/brands/:brandId/competitors', () => {
  beforeEach(async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.brands.findFirst).mockResolvedValue({
      id: 'brand-0001', organization_id: 'org-brands-0001', deleted_at: null,
    } as never)
  })

  it('creates a competitor', async () => {
    const res = await app.request('/api/orgs/acme/brands/brand-0001/competitors', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Rival Co' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})
