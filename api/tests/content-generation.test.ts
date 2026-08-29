import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 'user-cg-001', email: 'test@bebest.dev', name: 'Test', deleted_at: null }) },
    organizations: { findUnique: vi.fn().mockResolvedValue({ id: 'org-cg-001', name: 'Acme', slug: 'acme', deleted_at: null, created_at: new Date() }) },
    memberships: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1', user_id: 'user-cg-001', role: 'owner' }) },
    brands: { findFirst: vi.fn().mockResolvedValue(null) },
    content_briefs: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'brief-001', brand_id: 'brand-001', content_type: 'blog_post', title: 'Test Brief', status: 'draft', keywords: [], outline: [], created_at: new Date(), updated_at: new Date() }),
      update: vi.fn().mockResolvedValue({ id: 'brief-001', deleted_at: new Date() }),
      count: vi.fn().mockResolvedValue(0),
    },
    generated_content: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'draft-001', brief_id: 'brief-001', brand_id: 'brand-001', provider_name: 'ollama', body: 'Test content', word_count: 600, ai_readiness_score: 70, status: 'draft' }),
      update: vi.fn().mockResolvedValue({ id: 'draft-001', status: 'approved' }),
    },
  },
}))

vi.mock('../src/lib/ai-provider.js', () => ({
  completeWithFallback: vi.fn().mockResolvedValue({ text: 'This is generated content about CRM software. FAQ: What is CRM? A CRM helps businesses.', provider: 'ollama', model: 'llama3' }),
}))

const authHeaders = { 'x-user-id': 'user-cg-001', 'Content-Type': 'application/json' }
const base = '/api/orgs/acme/brands/brand-001/content-generation'

async function buildApp() {
  const { default: contentGenerationRouter } = await import('../src/routes/content-generation.js')
  const app = new Hono()
  app.route('/api/orgs/:slug/brands/:brandId/content-generation', contentGenerationRouter)
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}

async function withBrand() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.brands.findFirst).mockResolvedValueOnce({
    id: 'brand-001', organization_id: 'org-cg-001', deleted_at: null,
  } as never)
}

async function withBrief() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.content_briefs.findFirst).mockResolvedValueOnce({
    id: 'brief-001', brand_id: 'brand-001', content_type: 'blog_post', title: 'Test Brief',
    status: 'draft', keywords: [], outline: [], created_at: new Date(), updated_at: new Date(), deleted_at: null,
  } as never)
}

async function withDraft() {
  const { db } = await import('../src/lib/db.js')
  vi.mocked(db.generated_content.findFirst).mockResolvedValueOnce({
    id: 'draft-001', brief_id: 'brief-001', brand_id: 'brand-001', provider_name: 'ollama',
    body: 'Test content', word_count: 600, ai_readiness_score: 70, status: 'draft',
  } as never)
}

describe('GET /content-generation', () => {
  it('returns 404 for unknown brand', async () => {
    const app = await buildApp()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with total and data', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(base, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('POST /content-generation', () => {
  it('returns 201 with id', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(base, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content_type: 'blog_post', title: 'Test Brief' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
  })
})

describe('GET /content-generation/:briefId', () => {
  it('returns 404 for unknown brief', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/no-such-brief`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with brief data', async () => {
    const app = await buildApp()
    await withBrand()
    await withBrief()
    const res = await app.request(`${base}/brief-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'brief-001')
  })
})

describe('DELETE /content-generation/:briefId', () => {
  it('returns 200 on success', async () => {
    const app = await buildApp()
    await withBrand()
    await withBrief()
    const res = await app.request(`${base}/brief-001`, { method: 'DELETE', headers: authHeaders })
    expect(res.status).toBe(200)
  })
})

describe('POST /content-generation/:briefId/generate', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/brief-001/generate`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('GET /content-generation/:briefId/drafts', () => {
  it('returns 200 array', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/brief-001/drafts`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as unknown
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /content-generation/:briefId/drafts/:draftId', () => {
  it('returns 404 for unknown draft', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/brief-001/drafts/no-such-draft`, { headers: authHeaders })
    expect(res.status).toBe(404)
  })

  it('returns 200 with draft data', async () => {
    const app = await buildApp()
    await withBrand()
    await withDraft()
    const res = await app.request(`${base}/brief-001/drafts/draft-001`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id', 'draft-001')
  })
})

describe('POST /content-generation/:briefId/drafts/:draftId/score', () => {
  it('returns 202 queued', async () => {
    const app = await buildApp()
    await withBrand()
    const res = await app.request(`${base}/brief-001/drafts/draft-001/score`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(202)
    const body = await res.json() as Record<string, unknown>
    expect(body.queued).toBe(true)
  })
})

describe('PATCH /content-generation/:briefId/drafts/:draftId', () => {
  it('returns 200 with updated status', async () => {
    const app = await buildApp()
    await withBrand()
    await withDraft()
    const res = await app.request(`${base}/brief-001/drafts/draft-001`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('status', 'approved')
  })
})
