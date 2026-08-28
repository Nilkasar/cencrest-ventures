import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-ai-0001', email: 'ai@bebest.dev', name: 'AI User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-ai-0001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-ai-1', user_id: 'user-ai-0001', role: 'owner' }),
    },
    org_ai_providers: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'prov-0001',
        organization_id: 'org-ai-0001',
        provider_name: 'openai',
        model: 'gpt-4o-mini',
        is_active: true,
        priority: 1,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      update: vi.fn().mockResolvedValue({ id: 'prov-0001', model: 'gpt-4o', is_active: true, priority: 1 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    ai_usage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'usage-0001' }),
    },
  },
}))

vi.mock('../src/lib/ai-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ai-provider.js')>()
  return {
    ...actual,
    buildProvider: vi.fn().mockReturnValue({
      complete: vi.fn().mockResolvedValue({
        text: 'Hello!',
        model: 'gpt-4o-mini',
        provider: 'openai',
        tokens_in: 10,
        tokens_out: 5,
        latency_ms: 200,
        finish_reason: 'stop',
      }),
    }),
    encryptKey: vi.fn().mockReturnValue('iv:cipher:tag'),
    decryptKey: vi.fn().mockReturnValue('sk-test-key'),
  }
})

// Build a local test app with the AI router mounted
async function makeApp() {
  const { default: aiRouter } = await import('../src/routes/ai.js')
  const testApp = new Hono()
  testApp.route('/api/orgs/:slug/ai', aiRouter)
  testApp.notFound((c) => c.json({ error: 'Not found' }, 404))
  return testApp
}

const authHeaders = { 'x-user-id': 'user-ai-0001', 'Content-Type': 'application/json' }

describe('GET /api/orgs/:slug/ai/providers', () => {
  it('returns empty list', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/providers', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  it('returns 401 without auth', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/providers')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/orgs/:slug/ai/providers', () => {
  it('adds a provider and returns 201', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/providers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider_name: 'openai', model: 'gpt-4o-mini', api_key: 'sk-test' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.provider_name).toBe('openai')
  })

  it('never returns api_key_enc in response', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/providers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider_name: 'openai', model: 'gpt-4o-mini', api_key: 'sk-test' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).not.toHaveProperty('api_key_enc')
  })
})

describe('GET /api/orgs/:slug/ai/providers — never returns api_key_enc', () => {
  it('strips api_key_enc from listed providers', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.org_ai_providers.findMany).mockResolvedValueOnce([
      {
        id: 'prov-0001',
        organization_id: 'org-ai-0001',
        provider_name: 'openai',
        model: 'gpt-4o-mini',
        api_key_enc: 'iv:cipher:tag',
        is_active: true,
        priority: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ] as never)
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/providers', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    expect(body.length).toBe(1)
    expect(body[0]).not.toHaveProperty('api_key_enc')
  })
})

describe('POST /api/orgs/:slug/ai/test', () => {
  it('returns 404 for unknown/inactive provider', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/test', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider_name: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })

  it('calls provider and returns response when provider exists', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.org_ai_providers.findFirst).mockResolvedValueOnce({
      id: 'prov-0001',
      organization_id: 'org-ai-0001',
      provider_name: 'openai',
      model: 'gpt-4o-mini',
      api_key_enc: 'iv:cipher:tag',
      is_active: true,
      priority: 1,
      created_at: new Date(),
      updated_at: new Date(),
    } as never)
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/test', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider_name: 'openai' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('text')
    expect(body).toHaveProperty('provider')
  })
})

describe('GET /api/orgs/:slug/ai/usage', () => {
  it('returns totals object with zero counts on empty data', async () => {
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/usage', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('totals')
    const totals = body.totals as Record<string, unknown>
    expect(totals).toHaveProperty('tokens_in')
    expect(totals).toHaveProperty('tokens_out')
    expect(totals).toHaveProperty('requests')
    expect(totals.requests).toBe(0)
  })

  it('returns daily breakdown', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.ai_usage.findMany).mockResolvedValueOnce([
      {
        id: 'usage-0001',
        organization_id: 'org-ai-0001',
        provider_name: 'openai',
        model: 'gpt-4o-mini',
        tokens_in: 100,
        tokens_out: 50,
        cost_usd: '0.001',
        latency_ms: 300,
        finish_reason: 'stop',
        recorded_at: new Date('2024-01-15T10:00:00Z'),
      },
    ] as never)
    const app = await makeApp()
    const res = await app.request('/api/orgs/acme/ai/usage', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const totals = body.totals as Record<string, unknown>
    expect(totals.requests).toBe(1)
    expect(totals.tokens_in).toBe(100)
    const daily = body.daily as Array<Record<string, unknown>>
    expect(Array.isArray(daily)).toBe(true)
    expect(daily.length).toBe(1)
  })
})
