import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

const USER_ID = 'user-auth-0001'

vi.mock('../src/lib/db.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    form_submissions: { create: vi.fn().mockResolvedValue({ id: 'fs-1' }) },
    users: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'user-auth-0001', email: 'test@bebest.dev', name: 'Test', password_hash: '', email_verified: false, deleted_at: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme' }),
      update: vi.fn().mockResolvedValue({}),
    },
    memberships: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-auth-0001', role: 'owner' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    invitations: {
      deleteMany: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    refresh_tokens: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    auth_events: { create: vi.fn().mockResolvedValue({}) },
    magic_link_tokens: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    password_reset_tokens: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

describe('POST /api/auth/register', () => {
  it('registers a new user and returns tokens', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@bebest.dev', password: 'password123', name: 'Test' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('accessToken')
    expect(body).toHaveProperty('refreshToken')
    expect(body).toHaveProperty('user')
  })

  it('returns 409 if email already registered', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.users.findUnique).mockResolvedValueOnce({
      id: USER_ID, email: 'test@bebest.dev', name: 'Test',
      password_hash: 'x', email_verified: true, deleted_at: null,
    } as never)
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@bebest.dev', password: 'password123', name: 'Test' }),
    })
    expect(res.status).toBe(409)
  })

  it('returns 422 for weak password', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@bebest.dev', password: 'short', name: 'Test' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('POST /api/auth/login', () => {
  it('returns 401 for unknown user', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@bebest.dev', password: 'password123' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('always returns success (idempotent)', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'some-token' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('POST /api/auth/magic-link', () => {
  it('accepts a valid email', async () => {
    const res = await app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@bebest.dev' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects invalid email', async () => {
    const res = await app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('POST /api/auth/password-reset/request', () => {
  it('always returns success (user enumeration protection)', async () => {
    const res = await app.request('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@bebest.dev' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 without bearer token', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    })
    expect(res.status).toBe(401)
  })
})
