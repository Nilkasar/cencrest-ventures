import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-kw-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-kw-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-kw-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    keywords: {
      upsert: vi.fn().mockResolvedValue({ id: 'kw-1', brand_id: 'brand-0001', keyword: 'best crm', volume: 1000 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    brand_keyword_rankings: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    keyword_clusters: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'cluster-1', brand_id: 'brand-0001', cluster_name: 'CRM tools' }),
    },
  },
}))

const authHeaders = { 'x-user-id': 'user-kw-0001', 'Content-Type': 'application/json' }
const brandPath = '/api/orgs/acme/brands/brand-0001/keywords'

function withBrand() {
  return import('../src/lib/db.js').then(({ db }) => {
    vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
      id: 'brand-0001', organization_id: 'org-kw-0001', deleted_at: null,
    } as never)
  })
}

describe('GET /keywords', () => {
  it('returns 404 when brand not found', async () => {
    const res = await app.request(brandPath, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns paginated list', async () => {
    await withBrand()
    const res = await app.request(brandPath, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('POST /keywords', () => {
  it('adds a single keyword', async () => {
    await withBrand()
    const res = await app.request(brandPath, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ keyword: 'best crm', volume: 1000 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toHaveProperty('id')
  })

  it('adds multiple keywords', async () => {
    await withBrand()
    const res = await app.request(brandPath, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify([{ keyword: 'crm software' }, { keyword: 'crm tools' }]),
    })
    expect(res.status).toBe(201)
  })

  it('returns 404 for unknown brand', async () => {
    const res = await app.request(brandPath, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ keyword: 'test' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /keywords/gaps', () => {
  it('returns gap keywords', async () => {
    await withBrand()
    const res = await app.request(`${brandPath}/gaps`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
  })
})

describe('GET /keywords/clusters', () => {
  it('returns clusters', async () => {
    await withBrand()
    const res = await app.request(`${brandPath}/clusters`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})

describe('POST /keywords/clusters', () => {
  it('creates a cluster', async () => {
    await withBrand()
    const res = await app.request(`${brandPath}/clusters`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ cluster_name: 'CRM tools', keyword_ids: [] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('POST /keywords/import', () => {
  it('imports keywords from CSV', async () => {
    await withBrand()
    const csv = 'keyword,volume,difficulty,intent\nbest crm,1000,45,commercial\ncrm tools,500,30,informational'
    const res = await app.request(`${brandPath}/import`, {
      method: 'POST',
      headers: { 'x-user-id': 'user-kw-0001', 'Content-Type': 'text/csv' },
      body: csv,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('imported')
    expect(body).toHaveProperty('skipped')
  })

  it('returns 415 for wrong content type', async () => {
    await withBrand()
    const res = await app.request(`${brandPath}/import`, {
      method: 'POST',
      headers: { 'x-user-id': 'user-kw-0001', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(415)
  })
})

describe('GET /keywords/competitor-overlap', () => {
  it('returns overlap keywords', async () => {
    await withBrand()
    const res = await app.request(`${brandPath}/competitor-overlap`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.data)).toBe(true)
  })
})
