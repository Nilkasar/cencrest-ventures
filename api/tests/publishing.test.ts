import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-pub-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-pub-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-pub-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    publish_jobs: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'job-001', brand_id: 'brand-001', destination: 'wordpress', status: 'draft', publish_log: [], created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'job-001', status: 'pending_approval' }),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

vi.mock('../src/lib/publisher.js', () => ({
  submitForApproval: vi.fn().mockResolvedValue(undefined),
  approveJob: vi.fn().mockResolvedValue(undefined),
  rejectJob: vi.fn().mockResolvedValue(undefined),
  scheduleJob: vi.fn().mockResolvedValue(undefined),
  executePublish: vi.fn().mockResolvedValue(undefined),
}))

const authHeaders = { 'x-user-id': 'user-pub-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/publishing'

async function buildApp() {
  const { default: publishingRoute } = await import('../src/routes/publishing.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/publishing', publishingRoute)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-pub-001', deleted_at: null,
  } as never)
}

async function withJob() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.publish_jobs.findFirst).mockResolvedValueOnce({
    id: 'job-001', brand_id: 'brand-001', status: 'draft', publish_log: [], deleted_at: null,
  } as never)
}

describe('GET /publishing', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with pagination shape', async () => {
    const app = await buildApp()
    await withBrand()
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.publish_jobs.count).mockResolvedValueOnce(3)
    vi.mocked(db.publish_jobs.findMany).mockResolvedValueOnce([
      { id: 'job-001', brand_id: 'brand-001', destination: 'wordpress', status: 'draft', created_at: new Date() },
    ] as never)
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(3)
  })
})

describe('POST /publishing', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ destination: 'wordpress' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 with id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ destination: 'wordpress' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('job-001')
  })
})

describe('GET /publishing/:jobId', () => {
  it('returns 404 for unknown job', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/no-such-job`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with data', async () => {
    const app = await buildApp()
    await withBrand()
    await withJob()
    const res = await app.request(`${base}/job-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.id).toBe('job-001')
  })
})

describe('DELETE /publishing/:jobId', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    await withJob()
    const res = await app.request(`${base}/job-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /publishing/:jobId/submit', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/job-001/submit`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /publishing/:jobId/approve', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/job-001/approve`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /publishing/:jobId/reject', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/job-001/reject`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Not ready' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /publishing/:jobId/schedule', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/job-001/schedule`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ scheduled_at: new Date().toISOString() }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('POST /publishing/:jobId/publish', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/job-001/publish`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('GET /publishing/:jobId/log', () => {
  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    await withJob()
    const res = await app.request(`${base}/job-001/log`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
