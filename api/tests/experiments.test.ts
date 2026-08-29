import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-ex-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-ex-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-ex-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    experiments: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'exp-001', brand_id: 'brand-001', name: 'Test Exp', experiment_type: 'content', status: 'draft', result_summary: {}, created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'exp-001', status: 'running' }),
    },
    experiment_measurements: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'meas-001', experiment_id: 'exp-001', variant: 'control', metric_name: 'visibility_score', metric_value: 75 }),
    },
  },
}))

vi.mock('../src/lib/experimentation.js', () => ({
  analyzeExperiment: vi.fn().mockResolvedValue({ experiment_id: 'exp-001', winner: 'variant', metrics: {}, measurement_count: 10 }),
  recordMeasurement: vi.fn().mockResolvedValue(undefined),
  startExperiment: vi.fn().mockResolvedValue(undefined),
  endExperiment: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-ex-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/experiments'

async function buildApp() {
  const { default: experimentsRoute } = await import('../src/routes/experiments.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/experiments', experimentsRoute)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-ex-001', deleted_at: null,
  } as never)
}

async function withExp() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.experiments.findFirst).mockResolvedValueOnce({
    id: 'exp-001', brand_id: 'brand-001', status: 'draft', result_summary: {}, winner: null, deleted_at: null,
  } as never)
}

describe('GET /experiments', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with array', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.experiments.findMany).mockResolvedValueOnce([
      { id: 'exp-001', brand_id: 'brand-001', name: 'Test Exp', experiment_type: 'content', status: 'draft', created_at: new Date() },
    ] as never)
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /experiments', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Test', experiment_type: 'content' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 with id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Test Exp', experiment_type: 'content' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('GET /experiments/:id', () => {
  it('returns 404 for unknown experiment', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/exp-unknown`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with experiment data', async () => {
    const app = await buildApp()
    await withBrand()
    await withExp()
    const res = await app.request(`${base}/exp-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'exp-001')
  })
})

describe('DELETE /experiments/:id', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    await withExp()
    const res = await app.request(`${base}/exp-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('deleted', true)
  })
})

describe('POST /experiments/:id/start', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/exp-001/start`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('queued', true)
  })
})

describe('POST /experiments/:id/end', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/exp-001/end`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('queued', true)
  })
})

describe('POST /experiments/:id/measure', () => {
  it('returns 201 recorded', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/exp-001/measure`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ variant: 'control', metric_name: 'visibility_score', metric_value: 75 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('recorded', true)
  })
})

describe('GET /experiments/:id/measurements', () => {
  it('returns 200 with array', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.experiment_measurements.findMany).mockResolvedValueOnce([
      { id: 'meas-001', experiment_id: 'exp-001', variant: 'control', metric_name: 'visibility_score', metric_value: 75 },
    ] as never)
    const res = await app.request(`${base}/exp-001/measurements`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /experiments/:id/results', () => {
  it('returns 200 with winner', async () => {
    const app = await buildApp()
    await withBrand()
    await withExp()
    const res = await app.request(`${base}/exp-001/results`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('winner')
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('result_summary')
  })
})
