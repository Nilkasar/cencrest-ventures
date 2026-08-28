import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-snap-0001', email: 'test@bebest.dev', name: 'Test', deleted_at: null,
      }),
    },
    snapshot_requests: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: 'snap-0001',
        domain: 'example.com',
        email: 'user@example.com',
        status: 'pending',
        result_json: null,
        ip_address: '1.2.3.4',
        marketing_consent: false,
        converted_to_org_id: null,
        converted_at: null,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('../src/lib/snapshot-pipeline.js', () => ({
  runSnapshot: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/lib/meta-fetch.js', () => ({
  validateDomain: vi.fn().mockReturnValue('example.com'),
  isPrivateIp: vi.fn().mockReturnValue(false),
  fetchSiteMeta: vi.fn().mockResolvedValue({ name: 'Example', description: 'A site', logoUrl: null }),
}))

async function buildApp() {
  const { default: snapshots } = await import('../src/routes/snapshots.js')
  const app = new Hono()
  app.route('/api/snapshots', snapshots)
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}

const jsonHeaders = { 'Content-Type': 'application/json' }
const authHeaders = { 'x-user-id': 'user-snap-0001', 'Content-Type': 'application/json' }

describe('POST /api/snapshots', () => {
  it('returns 202 with snapshotId for valid domain', async () => {
    const app = await buildApp()
    const res = await app.request('/api/snapshots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ domain: 'example.com', email: 'user@example.com' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('snapshotId')
    expect(body.message).toBe('Snapshot started')
  })

  it('returns 422 for private IP domain', async () => {
    const { validateDomain } = await import('../src/lib/meta-fetch.js')
    vi.mocked(validateDomain).mockReturnValueOnce(null)

    const app = await buildApp()
    const res = await app.request('/api/snapshots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ domain: '192.168.1.1', email: 'user@example.com' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })

  it('returns 422 for invalid email', async () => {
    const app = await buildApp()
    const res = await app.request('/api/snapshots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ domain: 'example.com', email: 'not-an-email' }),
    })
    // zValidator returns 400 for schema violations
    expect([400, 422]).toContain(res.status)
  })
})

describe('GET /api/snapshots/:id', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 202 when snapshot is processing', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.snapshot_requests.findUnique).mockResolvedValueOnce({
      id: 'snap-0001',
      domain: 'example.com',
      email: 'user@example.com',
      status: 'processing',
      result_json: null,
      ip_address: '1.2.3.4',
      marketing_consent: false,
      converted_to_org_id: null,
      converted_at: null,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_at: new Date(),
      updated_at: new Date(),
    } as never)

    const app = await buildApp()
    const res = await app.request('/api/snapshots/snap-0001')
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('processing')
    expect(body.message).toBe('Processing...')
  })

  it('returns full result when snapshot is complete', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.snapshot_requests.findUnique).mockResolvedValueOnce({
      id: 'snap-0001',
      domain: 'example.com',
      email: 'user@example.com',
      status: 'complete',
      result_json: {
        domain: 'example.com',
        siteName: 'Example',
        score: 40,
        totalQueries: 10,
        mentionCount: 4,
        gaps: [],
        topCompetitors: [],
        generatedAt: new Date().toISOString(),
      },
      ip_address: '1.2.3.4',
      marketing_consent: false,
      converted_to_org_id: null,
      converted_at: null,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_at: new Date(),
      updated_at: new Date(),
    } as never)

    const app = await buildApp()
    const res = await app.request('/api/snapshots/snap-0001')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.domain).toBe('example.com')
    expect(body.status).toBe('complete')
    expect(body).toHaveProperty('score')
  })

  it('returns 404 for unknown snapshot id', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.snapshot_requests.findUnique).mockResolvedValueOnce(null)

    const app = await buildApp()
    const res = await app.request('/api/snapshots/unknown-id')
    expect(res.status).toBe(404)
  })
})
