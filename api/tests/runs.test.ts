import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-runs-0001', email: 'runs@bebest.dev', name: 'Runs User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-runs-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-runs-1', user_id: 'user-runs-0001', role: 'owner' }),
    },
    brands: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    prompt_runs: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: 'run-0001',
        brand_id: 'brand-0001',
        trigger: 'manual',
        status: 'queued',
        total_prompts: 0,
        completed_prompts: 0,
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: 'run-0001',
        brand_id: 'brand-0001',
        status: 'cancelled',
        total_prompts: 0,
        completed_prompts: 0,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    },
    ai_responses: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

vi.mock('../src/lib/prompt-runner.js', () => ({
  executeRun: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-runs-0001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-0001/runs'

async function makeApp() {
  const { default: runsRouter } = await import('../src/routes/runs.js')
  const testApp = new Hono()
  testApp.route('/api/orgs/:slug/brands/:brandId/runs', runsRouter)
  testApp.notFound((c) => c.json({ error: 'Not found' }, 404))
  return testApp
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-0001', organization_id: 'org-runs-0001', name: 'Acme Brand', deleted_at: null,
  } as never)
}

describe('POST /runs — trigger a run', () => {
  it('creates a run and returns 202', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ trigger: 'manual' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.status).toBe('queued')
  })

  it('returns 409 when a run is already active', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-active', brand_id: 'brand-0001', status: 'running',
    } as never)
    const app = await makeApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })

  it('returns 404 when brand not found', async () => {
    const app = await makeApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /runs — list runs', () => {
  it('returns paginated list', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.count).mockResolvedValueOnce(2)
    vi.mocked(db.prompt_runs.findMany).mockResolvedValueOnce([
      { id: 'run-0001', brand_id: 'brand-0001', status: 'complete', created_at: new Date() } as never,
      { id: 'run-0002', brand_id: 'brand-0001', status: 'failed', created_at: new Date() } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}?page=1&limit=10`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('data')
    expect(body.total).toBe(2)
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('GET /runs/:runId — run detail', () => {
  it('returns run detail with stats', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-0001',
      brand_id: 'brand-0001',
      status: 'complete',
      total_prompts: 10,
      completed_prompts: 10,
      trigger: 'manual',
      error_message: null,
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    } as never)
    vi.mocked(db.ai_responses.findMany).mockResolvedValueOnce([
      { id: 'resp-1', latency_ms: 200, tokens_in: 10, tokens_out: 20 } as never,
      { id: 'resp-2', latency_ms: 400, tokens_in: 15, tokens_out: 30 } as never,
    ])
    const app = await makeApp()
    const res = await app.request(`${base}/run-0001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('successRate')
    expect(body).toHaveProperty('avgLatency')
    expect(body).toHaveProperty('totalCost')
    expect(typeof body.successRate).toBe('number')
    expect(typeof body.avgLatency).toBe('number')
  })

  it('returns 404 for unknown run', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/no-such-run`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /runs/:runId — cancel run', () => {
  it('cancels run and returns updated record', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-0001', brand_id: 'brand-0001', status: 'running',
    } as never)
    const app = await makeApp()
    const res = await app.request(`${base}/run-0001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('cancelled')
  })

  it('returns 404 when run not found', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/no-such-run`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /runs/:runId/responses — paginated ai_responses', () => {
  it('returns paginated responses', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-0001', brand_id: 'brand-0001', status: 'complete',
    } as never)
    vi.mocked(db.ai_responses.count).mockResolvedValueOnce(1)
    vi.mocked(db.ai_responses.findMany).mockResolvedValueOnce([
      {
        id: 'resp-1',
        prompt_job_id: 'job-1',
        query_id: 'query-1',
        provider_name: 'openai',
        model: 'gpt-4o-mini',
        prompt_text: 'what is crm',
        response_text: 'CRM stands for...',
        tokens_in: 10,
        tokens_out: 20,
        latency_ms: 300,
        created_at: new Date(),
      },
    ] as never)
    const app = await makeApp()
    const res = await app.request(`${base}/run-0001/responses`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(1)
  })

  it('supports ?provider= filter', async () => {
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.prompt_runs.findFirst).mockResolvedValueOnce({
      id: 'run-0001', brand_id: 'brand-0001', status: 'complete',
    } as never)
    vi.mocked(db.ai_responses.count).mockResolvedValueOnce(0)
    vi.mocked(db.ai_responses.findMany).mockResolvedValueOnce([])
    const app = await makeApp()
    const res = await app.request(`${base}/run-0001/responses?provider=anthropic`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.total).toBe(0)
  })

  it('returns 404 when run not found', async () => {
    await withBrand()
    const app = await makeApp()
    const res = await app.request(`${base}/no-such-run/responses`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })
})
