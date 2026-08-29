import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-st-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-st-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-st-001', role: 'owner' }) },
    entrepreneur_stories: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'story-001', org_id: 'org-st-001', author_name: 'Jane Doe', title: 'How we grew 10x', story_type: 'growth_story', status: 'draft', featured: false, tags: [], metrics: {}, created_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'story-001', status: 'published', published_at: new Date() }),
    },
  },
}))

const authHeaders = { 'x-user-id': 'user-st-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/stories'

async function buildApp() {
  const { default: storiesRoute } = await import('../src/routes/stories.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/stories', storiesRoute)
  return app
}

async function withStory() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.entrepreneur_stories.findFirst).mockResolvedValueOnce({
    id: 'story-001', org_id: 'org-st-001', status: 'draft', featured: false, published_at: null, deleted_at: null,
  } as never)
}

describe('GET /stories', () => {
  it('returns 200 array', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /stories', () => {
  it('returns 201 with id', async () => {
    const app = await buildApp()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ author_name: 'Jane Doe', title: 'How we grew 10x', story_type: 'growth_story' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('story-001')
  })
})

describe('GET /stories/featured', () => {
  it('returns 200 array', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/featured`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /stories/public', () => {
  it('returns 200 sanitized array without auth', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/public`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /stories/:id', () => {
  it('returns 404 for unknown story', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/unknown-id`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with story data', async () => {
    await withStory()
    const app = await buildApp()
    const res = await app.request(`${base}/story-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('story-001')
  })
})

describe('PATCH /stories/:id', () => {
  it('returns 404 for unknown story', async () => {
    const app = await buildApp()
    const res = await app.request(`${base}/unknown-id`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Updated' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 updated', async () => {
    await withStory()
    const app = await buildApp()
    const res = await app.request(`${base}/story-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'published' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('published')
  })
})

describe('DELETE /stories/:id', () => {
  it('returns 200 success', async () => {
    await withStory()
    const app = await buildApp()
    const res = await app.request(`${base}/story-001`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('POST /stories/:id/publish', () => {
  it('returns 200 with published story', async () => {
    await withStory()
    const app = await buildApp()
    const res = await app.request(`${base}/story-001/publish`, {
      method: 'POST',
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('published')
  })
})
