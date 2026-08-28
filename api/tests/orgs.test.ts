import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

const ORG_ID = 'org-uuid-0001'
const USER_ID = 'user-uuid-0001'
const MEMBER_ID = 'mbr-uuid-0001'

vi.mock('../src/lib/db.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    form_submissions: { create: vi.fn().mockResolvedValue({ id: 'fs-1' }) },
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-uuid-0001', email: 'owner@example.com', name: 'Owner', deleted_at: null,
      }),
    },
    organizations: {
      // default null = no slug conflict; tests that need the org override with mockResolvedValueOnce
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'org-uuid-0001', name: 'Acme', slug: 'acme' }),
      update: vi.fn().mockResolvedValue({ id: 'org-uuid-0001', name: 'Acme Updated', slug: 'acme' }),
    },
    memberships: {
      create: vi.fn().mockResolvedValue({ id: 'mbr-uuid-0001' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'mbr-uuid-0001', user_id: 'user-uuid-0001', role: 'owner' }),
      findMany: vi.fn().mockResolvedValue([{
        user_id: 'user-uuid-0001', role: 'owner', created_at: new Date(),
        users: { id: 'user-uuid-0001', email: 'owner@example.com', name: 'Owner' },
      }]),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    invitations: {
      deleteMany: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'inv-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

const authHeader = { 'x-user-id': USER_ID }

describe('POST /api/orgs', () => {
  it('creates an org and returns 201', async () => {
    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ name: 'Acme' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.slug).toBe('acme')
  })

  it('returns 401 without auth header', async () => {
    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 422 for short org name', async () => {
    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ name: 'A' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('GET /api/orgs/:slug', () => {
  it('returns org details for a member', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(
      { id: ORG_ID, name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() } as never,
    )
    const res = await app.request('/api/orgs/acme', { headers: authHeader })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.slug).toBe('acme')
  })
})

describe('GET /api/orgs/:slug/members', () => {
  it('lists members', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(
      { id: ORG_ID, name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() } as never,
    )
    const res = await app.request('/api/orgs/acme/members', { headers: authHeader })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].role).toBe('owner')
  })
})

describe('POST /api/orgs/:slug/invitations', () => {
  it('creates an invitation', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(
      { id: ORG_ID, name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() } as never,
    )
    const res = await app.request('/api/orgs/acme/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ email: 'newmember@example.com', role: 'member' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('rejects invalid email', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(
      { id: ORG_ID, name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() } as never,
    )
    const res = await app.request('/api/orgs/acme/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('RBAC — member cannot change roles', () => {
  it('returns 403 for insufficient role', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.organizations.findUnique).mockResolvedValueOnce(
      { id: ORG_ID, name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() } as never,
    )
    vi.mocked(db.memberships.findFirst).mockResolvedValueOnce(
      { id: MEMBER_ID, user_id: USER_ID, role: 'member' } as never,
    )
    const res = await app.request(`/api/orgs/acme/members/${USER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(403)
  })
})
