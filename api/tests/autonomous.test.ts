import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-au-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-au-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-au-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    autonomous_schedules: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'sched-001', brand_id: 'brand-001', schedule_type: 'process_signals', enabled: true, run_count: 0 }),
      update: vi.fn().mockResolvedValue({ id: 'sched-001', enabled: false }),
      delete: vi.fn().mockResolvedValue({ id: 'sched-001' }),
    },
    autonomous_run_logs: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'log-001', schedule_id: 'sched-001', status: 'running' }),
      update: vi.fn().mockResolvedValue({ id: 'log-001', status: 'completed' }),
    },
    growth_agent_runs: {
      create: vi.fn().mockResolvedValue({ id: 'gr-001' }),
    },
  },
}))

vi.mock('../src/lib/autonomous-ops.js', () => ({
  executeSchedule: vi.fn().mockResolvedValue(undefined),
  getScheduleStatus: vi.fn().mockResolvedValue({ id: 'sched-001', brand_id: 'brand-001', schedule_type: 'process_signals', enabled: true, run_count: 1, recent_logs: [] }),
}))

vi.mock('../src/lib/learning-loop.js', () => ({
  processSignals: vi.fn().mockResolvedValue(5),
}))

vi.mock('../src/lib/action-center.js', () => ({
  syncActionsFromRecommendations: vi.fn().mockResolvedValue(3),
  syncActionsFromGeoGaps: vi.fn().mockResolvedValue(2),
}))

const authHeaders = { 'x-user-id': 'user-au-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/autonomous'

async function buildApp() {
  const { default: autonomousRoute } = await import('../src/routes/autonomous.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/autonomous', autonomousRoute)
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({ id: 'brand-001', organization_id: 'org-au-001', deleted_at: null } as never)
}

async function withSchedule() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.autonomous_schedules.findFirst).mockResolvedValueOnce({ id: 'sched-001', brand_id: 'brand-001', org_id: 'org-au-001', schedule_type: 'process_signals', enabled: true } as never)
}

describe('GET /autonomous/schedules', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/schedules`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/schedules`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})

describe('POST /autonomous/schedules', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ schedule_type: 'process_signals' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 201 with id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ schedule_type: 'process_signals' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('GET /autonomous/schedules/:id', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/schedules/sched-001`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with status', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/schedules/sched-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('recent_logs')
  })
})

describe('PATCH /autonomous/schedules/:id', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/schedules/sched-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 updated', async () => {
    const app = await buildApp()
    await withBrand()
    await withSchedule()
    const res = await app.request(`${base}/schedules/sched-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('DELETE /autonomous/schedules/:id', () => {
  it('returns 200 success', async () => {
    const app = await buildApp()
    await withBrand()
    await withSchedule()
    const res = await app.request(`${base}/schedules/sched-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /autonomous/schedules/:id/trigger', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    await withBrand()
    await withSchedule()
    const res = await app.request(`${base}/schedules/sched-001/trigger`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('GET /autonomous/logs', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/logs`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/logs`, { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})
