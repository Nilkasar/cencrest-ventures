import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-ga-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-ga-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-ga-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    geo_agent_runs: {
      create: vi.fn().mockResolvedValue({ id: 'run-ga-001', brand_id: 'brand-001', status: 'pending', created_at: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'run-ga-001', status: 'completed' }),
    },
    geo_agent_actions: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'action-001', agent_run_id: 'run-ga-001', status: 'pending' }),
    },
    geo_gaps: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('../src/lib/geo-agent.js', () => ({
  runGeoAgent: vi.fn().mockResolvedValue(undefined),
  getAgentRunStatus: vi.fn().mockResolvedValue({ id: 'run-ga-001', status: 'completed', geo_agent_actions: [] }),
}))

const authHeaders = { 'x-user-id': 'user-ga-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/geo-agent'

async function buildApp() {
  const { default: geoAgent } = await import('../src/routes/geo-agent.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/geo-agent', geoAgent)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-ga-001', deleted_at: null,
  } as never)
}

async function withRun() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.geo_agent_runs.findFirst).mockResolvedValueOnce({
    id: 'run-ga-001', brand_id: 'brand-001', status: 'completed', geo_agent_actions: [],
  } as never)
}

describe('POST /geo-agent/run', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    // brands.findFirst returns null by default
    const res = await app.request(`${base}/run`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns 202 with run_id when brand exists', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/run`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('run_id')
    expect(body.status).toBe('queued')
  })
})

describe('GET /geo-agent/runs', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with array of runs', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /geo-agent/runs/:runId', () => {
  it('returns 404 for unknown run', async () => {
    const app = await buildApp()
    await withBrand()
    // geo_agent_runs.findFirst returns null by default
    const res = await app.request(`${base}/runs/no-such-run`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with run and actions', async () => {
    const app = await buildApp()
    await withBrand()
    await withRun()
    const res = await app.request(`${base}/runs/run-ga-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('run-ga-001')
    expect(body).toHaveProperty('geo_agent_actions')
  })
})

describe('GET /geo-agent/runs/:runId/actions', () => {
  it('returns 200 with array of actions', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/runs/run-ga-001/actions`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
