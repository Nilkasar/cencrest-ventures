import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

vi.mock('../src/lib/db.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    form_submissions: {
      create: vi.fn().mockResolvedValue({ id: 'test-uuid-5678' }),
    },
  },
}))

describe('POST /api/forms/:formId', () => {
  it('accepts a valid apply form submission', async () => {
    const res = await app.request('/api/forms/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test User',
        company: 'Acme Corp',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.id).toBe('test-uuid-5678')
  })

  it('rejects invalid email', async () => {
    const res = await app.request('/api/forms/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(422)
  })

  it('rejects unknown form id', async () => {
    const res = await app.request('/api/forms/unknown-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects malformed JSON', async () => {
    const res = await app.request('/api/forms/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown route', async () => {
    const res = await app.request('/api/nonexistent')
    expect(res.status).toBe(404)
  })
})
