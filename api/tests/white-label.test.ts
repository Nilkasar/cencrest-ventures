import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-wl-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-wl-001', name: 'Agency', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-wl-001', role: 'owner' }) },
    white_label_configs: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'wl-001', agency_org_id: 'org-wl-001', brand_name: 'MyBrand', enabled: true, hide_powered_by: false, config: {} }),
      update: vi.fn().mockResolvedValue({ id: 'wl-001', enabled: false }),
      delete: vi.fn().mockResolvedValue({ id: 'wl-001' }),
    },
  },
}))

const authHeaders = { 'x-user-id': 'user-wl-001', 'Content-Type': 'application/json' }
const BASE = '/api/orgs/acme/white-label'

async function buildApp() {
  const { default: whiteLabel } = await import('../src/routes/white-label.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/white-label', whiteLabel)
  return app
}

function withConfig() {
  return import('../src/lib/db.js').then(({ db }) => {
    vi.mocked(db.white_label_configs.findFirst).mockResolvedValueOnce({
      id: 'wl-001',
      agency_org_id: 'org-wl-001',
      brand_name: 'MyBrand',
      enabled: true,
      hide_powered_by: false,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      config: {},
    } as never)
  })
}

describe('GET /white-label', () => {
  it('returns { enabled: false, configured: false } when no config', async () => {
    const app = await buildApp()
    const res = await app.request(BASE, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.enabled).toBe(false)
    expect(body.configured).toBe(false)
  })

  it('returns config when exists', async () => {
    await withConfig()
    const app = await buildApp()
    const res = await app.request(BASE, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'wl-001')
    expect(body).toHaveProperty('brand_name', 'MyBrand')
  })
})

describe('PUT /white-label', () => {
  it('returns 200 with created config when none exists', async () => {
    const app = await buildApp()
    const res = await app.request(BASE, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ brand_name: 'MyBrand' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'wl-001')
    expect(body).toHaveProperty('brand_name', 'MyBrand')
  })

  it('returns 200 with updated config when exists', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.white_label_configs.findFirst).mockResolvedValueOnce({
      id: 'wl-001',
      agency_org_id: 'org-wl-001',
      brand_name: 'MyBrand',
      enabled: true,
      hide_powered_by: false,
    } as never)
    vi.mocked(db.white_label_configs.update).mockResolvedValueOnce({
      id: 'wl-001',
      brand_name: 'UpdatedBrand',
      enabled: true,
    } as never)
    const app = await buildApp()
    const res = await app.request(BASE, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ brand_name: 'UpdatedBrand' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'wl-001')
  })
})

describe('PATCH /white-label/toggle', () => {
  it('returns 404 when no config', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/toggle`, { method: 'PATCH', headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with toggled enabled value', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.white_label_configs.findFirst).mockResolvedValueOnce({
      id: 'wl-001',
      agency_org_id: 'org-wl-001',
      brand_name: 'MyBrand',
      enabled: true,
      hide_powered_by: false,
    } as never)
    vi.mocked(db.white_label_configs.update).mockResolvedValueOnce({
      id: 'wl-001',
      enabled: false,
    } as never)
    const app = await buildApp()
    const res = await app.request(`${BASE}/toggle`, { method: 'PATCH', headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('enabled', false)
  })
})

describe('DELETE /white-label', () => {
  it('returns 404 when no config', async () => {
    const app = await buildApp()
    const res = await app.request(BASE, { method: 'DELETE', headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 success on delete', async () => {
    await withConfig()
    const app = await buildApp()
    const res = await app.request(BASE, { method: 'DELETE', headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /white-label/preview', () => {
  it('returns 200 with public fields when config exists', async () => {
    await withConfig()
    const app = await buildApp()
    const res = await app.request(`${BASE}/preview`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('brand_name')
    expect(body).toHaveProperty('logo_url')
    expect(body).toHaveProperty('primary_color')
    expect(body).toHaveProperty('secondary_color')
    expect(body).toHaveProperty('hide_powered_by')
    expect(body).toHaveProperty('enabled')
    expect(body).not.toHaveProperty('config')
  })

  it('returns defaults when no config', async () => {
    const app = await buildApp()
    const res = await app.request(`${BASE}/preview`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.enabled).toBe(false)
    expect(body.hide_powered_by).toBe(false)
  })
})
