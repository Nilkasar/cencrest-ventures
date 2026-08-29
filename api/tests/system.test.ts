import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/health.ts', () => ({
  deepHealthCheck: vi.fn().mockResolvedValue({ status: 'ok', db: 'ok', env: 'ok', uptime: 123, timestamp: new Date().toISOString() }),
  getSystemMetrics: vi.fn().mockResolvedValue({ memory: {}, uptime: 123, node_version: 'v24.0.0', env: 'test' }),
}))

vi.mock('../src/lib/db.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-sys-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-sys-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-sys-001', role: 'owner' }) },
  },
}))

import system from '../src/routes/system.js'

const app = new Hono()
app.route('/api/system', system)

describe('GET /api/system/health', () => {
  it('returns 200 with status field', async () => {
    const res = await app.request('/api/system/health')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('status')
  })
})

describe('GET /api/system/health/ready', () => {
  it('returns 200 with ready=true', async () => {
    const res = await app.request('/api/system/health/ready')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ready).toBe(true)
  })
})

describe('GET /api/system/metrics', () => {
  it('returns 200 with memory and uptime', async () => {
    const res = await app.request('/api/system/metrics', {
      headers: { 'x-user-id': 'user-sys-001' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('memory')
    expect(body).toHaveProperty('uptime')
  })
})

describe('GET /api/system/openapi', () => {
  it('returns 200 with openapi field', async () => {
    const res = await app.request('/api/system/openapi')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('openapi')
  })
})
