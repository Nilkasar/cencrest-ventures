import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-gr-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-gr-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-gr-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    growth_agent_runs: {
      create: vi.fn().mockResolvedValue({ id: 'run-gr-001', brand_id: 'brand-001', status: 'pending', created_at: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'run-gr-001', status: 'completed' }),
    },
  },
}))

vi.mock('../src/lib/growth-agent.js', () => ({
  runGrowthAgent: vi.fn().mockResolvedValue(undefined),
  getGrowthRunStatus: vi.fn().mockResolvedValue({ id: 'run-gr-001', status: 'completed', geo_run_id: 'geo-001', seo_run_id: 'seo-001' }),
}))

const authHeaders = { 'x-user-id': 'user-gr-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/growth-agent'

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-001', organization_id: 'org-gr-001', deleted_at: null } as never)
}

async function withRun() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.growth_agent_runs.findFirst).mockResolvedValueOnce({
    id: 'run-gr-001', brand_id: 'brand-001', org_id: 'org-gr-001', status: 'completed',
    geo_run_id: 'geo-001', seo_run_id: 'seo-001', total_gaps_processed: 3,
    total_opportunities_processed: 2, total_content_generated: 5, summary: {},
    created_at: new Date(), updated_at: new Date(),
  } as never)
}

describe('POST /growth-agent/run', () => {
  it('returns 404 for unknown brand', async () => {
    const res = await app.request(`${base}/run`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 202 with run_id', async () => {
    await withBrand()
    const res = await app.request(`${base}/run`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('run_id')
    expect(body.status).toBe('queued')
  })
})

describe('GET /growth-agent/runs', () => {
  it('returns 404 for unknown brand', async () => {
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns array of runs', async () => {
    await withBrand()
    const res = await app.request(`${base}/runs`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})

describe('GET /growth-agent/runs/:runId', () => {
  it('returns 404 for unknown run', async () => {
    await withBrand()
    const res = await app.request(`${base}/runs/no-such-id`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns run detail', async () => {
    await withBrand()
    await withRun()
    const res = await app.request(`${base}/runs/run-gr-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('status')
  })
})

describe('GET /growth-agent/status', () => {
  it('returns never_run when no runs exist', async () => {
    await withBrand()
    const res = await app.request(`${base}/status`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('never_run')
  })

  it('returns latest run', async () => {
    await withBrand()
    await withRun()
    const res = await app.request(`${base}/status`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})
