import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-rpt-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-rpt-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-rpt-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    reports: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'rpt-001', brand_id: 'brand-001', name: 'Test Report', type: 'visibility', format: 'json', status: 'pending', created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'rpt-001', status: 'completed' }),
      delete: vi.fn().mockResolvedValue({ id: 'rpt-001' }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('../src/lib/report-generator.js', () => ({
  generateReport: vi.fn().mockResolvedValue(undefined),
  getReportData: vi.fn().mockResolvedValue({ report: { id: 'rpt-001', type: 'visibility', status: 'completed' }, sections: [] }),
}))

const authHeaders = { 'x-user-id': 'user-rpt-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/reports'

async function makeApp() {
  const { default: reportsRouter } = await import('../src/routes/reports.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/reports', reportsRouter)
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-rpt-001', deleted_at: null,
  } as never)
}

async function withReport() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.reports.findFirst).mockResolvedValueOnce({
    id: 'rpt-001', brand_id: 'brand-001', name: 'Test', type: 'visibility', format: 'json', status: 'completed', metadata: { sections: [] },
  } as never)
}

describe('GET /reports', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with array', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /reports', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'My Report', type: 'visibility' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 with id and status', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'My Report', type: 'visibility' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('status', 'pending')
  })
})

describe('GET /reports/:id', () => {
  it('returns 404 for unknown report', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/rpt-999`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with report data', async () => {
    await withBrand()
    await withReport()
    const app = await makeApp()
    const res = await app.request(`${base}/rpt-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'rpt-001')
  })
})

describe('GET /reports/:id/data', () => {
  it('returns 200 with report and sections', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/rpt-001/data`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('report')
    expect(body).toHaveProperty('sections')
  })
})

describe('DELETE /reports/:id', () => {
  it('returns 200 success', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/rpt-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('success', true)
  })
})

describe('GET /reports/summary', () => {
  it('returns 200 with total, by_type, by_status', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('by_type')
    expect(body).toHaveProperty('by_status')
  })
})
