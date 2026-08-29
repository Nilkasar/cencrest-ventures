import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-sa-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-sa-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-sa-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    seo_agent_runs: {
      create: vi.fn().mockResolvedValue({ id: 'run-sa-001', brand_id: 'brand-001', status: 'pending', created_at: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'run-sa-001', status: 'completed' }),
    },
    seo_agent_actions: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'action-sa-001', agent_run_id: 'run-sa-001', status: 'pending' }),
    },
    opportunities: { findMany: vi.fn().mockResolvedValue([]) },
    keywords: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('../src/lib/seo-agent.js', () => ({
  runSeoAgent: vi.fn().mockResolvedValue(undefined),
  getSeoRunStatus: vi.fn().mockResolvedValue(null),
}))

const authHeaders = { 'x-user-id': 'user-sa-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/seo-agent'

async function makeApp() {
  const { default: seoAgentRouter } = await import('../src/routes/seo-agent.js')
  const testApp = new Hono()
  testApp.route('/api/orgs/:slug/brands/:brandId/seo-agent', seoAgentRouter)
  testApp.notFound((c) => c.json({ error: 'Not found' }, 404))
  return testApp
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-sa-001', deleted_at: null,
  } as never)
}

async function withRun() {
  const { getSeoRunStatus } = await import('../src/lib/seo-agent.js')
  vi.mocked(getSeoRunStatus).mockResolvedValueOnce({
    id: 'run-sa-001', brand_id: 'brand-001', status: 'completed', seo_agent_actions: [],
  } as never)
}

describe('POST /seo-agent/run', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/run`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('returns 202 with run_id when brand exists', async () => {
    await withBrand()
    const app = await makeApp()
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

describe('GET /seo-agent/runs', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with array', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /seo-agent/runs/:runId', () => {
  it('returns 404 for unknown run', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/runs/no-such-run`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with run and actions', async () => {
    await withRun()
    const app = await makeApp()
    const res = await app.request(`${base}/runs/run-sa-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('seo_agent_actions')
  })
})

describe('GET /seo-agent/runs/:runId/actions', () => {
  it('returns 200 with actions array', async () => {
    const app = await makeApp()
    const res = await app.request(`${base}/runs/run-sa-001/actions`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
