import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-int-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-int-0001', name: 'Acme', slug: 'acme-int', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-int-1', user_id: 'user-int-0001', role: 'owner' }),
    },
    integrations: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'integ-0001',
        integration_type: 'slack',
        status: 'connected',
        last_synced_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: 'integ-0001',
        integration_type: 'slack',
        status: 'disconnected',
        last_synced_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    },
    webhook_deliveries: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('../src/lib/meta-fetch.js', () => ({
  validateDomain: vi.fn().mockReturnValue(null),
  isPrivateIp: vi.fn().mockReturnValue(false),
  fetchSiteMeta: vi.fn().mockResolvedValue({ name: null, description: null, logoUrl: null }),
}))

const authHeaders = { 'x-user-id': 'user-int-0001', 'Content-Type': 'application/json' }

describe('GET /api/orgs/:slug/integrations', () => {
  it('returns empty array', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/orgs/:slug/integrations/slack/connect', () => {
  it('creates slack integration, returns 201', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations/slack/connect', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ webhook_url: 'https://hooks.slack.com/services/T000/B000/xxxx' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.status).toBe('connected')
  })

  it('returns 422 for missing webhook_url', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations/slack/connect', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
  })
})

describe('POST /api/orgs/:slug/integrations/webhook/connect with private IP', () => {
  it('returns 422 for private IP URL', async () => {
    const { isPrivateIp } = await import('../src/lib/meta-fetch.js')
    vi.mocked(isPrivateIp).mockReturnValueOnce(true)

    const res = await app.request('/api/orgs/acme-int/integrations/webhook/connect', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ url: 'https://192.168.1.1/hook', events: ['brand.updated'] }),
    })
    expect(res.status).toBe(422)
  })
})

describe('DELETE /api/orgs/:slug/integrations/:id', () => {
  beforeEach(async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.integrations.findFirst).mockResolvedValue({
      id: 'integ-0001',
      organization_id: 'org-int-0001',
      integration_type: 'slack' as never,
      status: 'connected' as never,
      config_enc: {} as never,
      last_synced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as never)
  })

  it('disconnects integration', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations/integ-0001', {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /api/orgs/:slug/integrations/webhooks/:id/log', () => {
  beforeEach(async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.integrations.findFirst).mockResolvedValue({
      id: 'integ-0001',
      organization_id: 'org-int-0001',
      integration_type: 'webhook' as never,
      status: 'connected' as never,
      config_enc: {} as never,
      last_synced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as never)
    vi.mocked(db.webhook_deliveries.findMany).mockResolvedValue([
      {
        id: 'del-0001',
        integration_id: 'integ-0001',
        event_type: 'brand.updated',
        payload: {} as never,
        status_code: 200,
        response_body: 'ok',
        attempt: 1,
        delivered_at: new Date(),
      } as never,
    ])
  })

  it('returns delivery log array', async () => {
    const res = await app.request('/api/orgs/acme-int/integrations/webhooks/integ-0001/log', {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
  })
})
