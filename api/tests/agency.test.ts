import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-ag-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-ag-001', name: 'Agency Co', slug: 'acme', deleted_at: null, created_at: new Date() }),
      findFirst: vi.fn().mockResolvedValue({ id: 'org-client-001', name: 'Client Co', slug: 'client' }),
    },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-ag-001', role: 'owner' }) },
    agency_clients: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ac-001', agency_org_id: 'org-ag-001', client_org_id: 'org-client-001', status: 'active', relationship_type: 'managed' }),
      update: vi.fn().mockResolvedValue({ id: 'ac-001', status: 'terminated' }),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

vi.mock('../src/lib/agency.js', () => ({
  addClient: vi.fn().mockResolvedValue({ id: 'ac-001', agency_org_id: 'org-ag-001', client_org_id: 'org-client-001', status: 'active' }),
  removeClient: vi.fn().mockResolvedValue(undefined),
  listClients: vi.fn().mockResolvedValue([]),
  getClientSummary: vi.fn().mockResolvedValue({ total_clients: 0, active_clients: 0, total_mrr: 0, by_status: { active: 0, paused: 0, terminated: 0 } }),
}))

const authHeaders = { 'x-user-id': 'user-ag-001', 'Content-Type': 'application/json' }
const BASE = '/api/orgs/acme/agency'

describe('GET /agency/clients', () => {
  it('returns 200 with array', async () => {
    const res = await app.request(`${BASE}/clients`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /agency/clients', () => {
  it('returns 201 with id', async () => {
    const res = await app.request(`${BASE}/clients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ client_org_id: 'a0000000-0000-0000-0000-000000000001' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('DELETE /agency/clients/:id', () => {
  it('returns 200 success', async () => {
    const res = await app.request(`${BASE}/clients/org-client-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /agency/clients/:id', () => {
  it('returns 404 when not found', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.agency_clients.findFirst).mockResolvedValueOnce(null)
    const res = await app.request(`${BASE}/clients/org-client-999`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with data when found', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.agency_clients.findFirst).mockResolvedValueOnce({
      id: 'ac-001',
      agency_org_id: 'org-ag-001',
      client_org_id: 'org-client-001',
      status: 'active',
      relationship_type: 'managed',
    } as never)
    const res = await app.request(`${BASE}/clients/org-client-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'ac-001')
  })
})

describe('PATCH /agency/clients/:id', () => {
  it('returns 200 updated', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.agency_clients.findFirst).mockResolvedValueOnce({
      id: 'ac-001',
      agency_org_id: 'org-ag-001',
      client_org_id: 'org-client-001',
      status: 'active',
    } as never)
    vi.mocked(db.agency_clients.update).mockResolvedValueOnce({
      id: 'ac-001',
      status: 'paused',
    } as never)
    const res = await app.request(`${BASE}/clients/org-client-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('GET /agency/summary', () => {
  it('returns 200 with summary shape', async () => {
    const res = await app.request(`${BASE}/summary`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total_clients')
    expect(body).toHaveProperty('active_clients')
    expect(body).toHaveProperty('total_mrr')
    expect(body).toHaveProperty('by_status')
  })
})
