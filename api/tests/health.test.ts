import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index.js'

// Mock the db module so tests don't need a real database
vi.mock('../src/lib/db.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    form_submissions: {
      create: vi.fn().mockResolvedValue({ id: 'test-uuid-1234' }),
    },
  },
}))

describe('GET /api/health', () => {
  it('returns 200 with status ok when db is connected', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.db).toBe('connected')
  })
})

describe('GET /api/version', () => {
  it('returns version info', async () => {
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('nodeVersion')
  })
})
