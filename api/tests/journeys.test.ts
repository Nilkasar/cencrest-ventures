import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-j-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-j-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-j-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    products: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    buyer_journeys: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'j-1', brand_id: 'brand-0001', stage: 'awareness', query: 'what is crm', generated_by: 'user' }),
      createMany: vi.fn().mockResolvedValue({ count: 40 }),
      update: vi.fn().mockResolvedValue({ id: 'j-1', query: 'updated query' }),
    },
  },
}))

const authHeaders = { 'x-user-id': 'user-j-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/journeys'

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-j-0001', name: 'Acme CRM',
    industry: 'crm', deleted_at: null,
  } as never)
}

describe('GET /journeys', () => {
  it('returns 404 for unknown brand', async () => {
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns grouped stages', async () => {
    await withBrand()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('stages')
  })
})

describe('POST /journeys/generate', () => {
  it('generates queries for brand', async () => {
    await withBrand()
    const res = await app.request(`${base}/generate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('generated')
    expect(body).toHaveProperty('skipped')
  })
})

describe('POST /journeys/queries', () => {
  it('adds a manual query', async () => {
    await withBrand()
    const res = await app.request(`${base}/queries`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ stage: 'awareness', query: 'what is crm', intent_type: 'informational' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })

  it('returns 400 for missing stage', async () => {
    await withBrand()
    const res = await app.request(`${base}/queries`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ query: 'missing stage' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /journeys/queries/:queryId', () => {
  it('returns 404 for unknown query', async () => {
    await withBrand()
    const res = await app.request(`${base}/queries/no-such-id`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ query: 'updated' }),
    })
    expect(res.status).toBe(404)
  })

  it('updates query', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.buyer_journeys.findFirst).mockResolvedValueOnce({ id: 'j-1', brand_id: 'brand-0001', deleted_at: null } as never)
    const res = await app.request(`${base}/queries/j-1`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ query: 'updated query' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /journeys/queries/:queryId', () => {
  it('soft-deletes a query', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.buyer_journeys.findFirst).mockResolvedValueOnce({ id: 'j-1', brand_id: 'brand-0001', deleted_at: null } as never)
    const res = await app.request(`${base}/queries/j-1`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /journeys/export', () => {
  it('exports CSV', async () => {
    await withBrand()
    const res = await app.request(`${base}/export`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
  })

  it('exports JSON', async () => {
    await withBrand()
    const res = await app.request(`${base}/export?format=json`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
