import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

const ORG_ID = 'org-billing-0001'
const USER_ID = 'user-billing-0001'

vi.mock('../src/lib/db.js', () => ({
  db: {
    users: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-billing-0001', email: 'billing@bebest.dev', name: 'Billing User', deleted_at: null,
      }),
    },
    organizations: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-billing-0001', name: 'BillingOrg', slug: 'billing-org', deleted_at: null, created_at: new Date(),
      }),
    },
    memberships: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-billing-1', user_id: 'user-billing-0001', role: 'owner' }),
    },
    subscriptions: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    usage_records: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

const authHeaders = { 'x-user-id': USER_ID, 'Content-Type': 'application/json' }

describe('GET /api/orgs/:slug/billing/subscription', () => {
  it('returns free plan when no subscription record exists', async () => {
    const res = await app.request('/api/orgs/billing-org/billing/subscription', {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.plan).toBe('free')
    expect(body.status).toBe('active')
  })

  it('returns subscription record when one exists', async () => {
    const { db } = await import('../src/lib/db.js')
    vi.mocked(db.subscriptions.findUnique).mockResolvedValueOnce({
      id: 'sub-1',
      organization_id: 'org-billing-0001',
      stripe_customer_id: 'cus_test',
      stripe_subscription_id: 'sub_test',
      plan: 'starter',
      status: 'active',
      current_period_start: new Date(),
      current_period_end: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    } as never)
    const res = await app.request('/api/orgs/billing-org/billing/subscription', {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.plan).toBe('starter')
  })
})

describe('GET /api/orgs/:slug/billing/usage', () => {
  it('returns all metrics with used and limit', async () => {
    const res = await app.request('/api/orgs/billing-org/billing/usage', {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, { used: number; limit: number }>
    const metrics = ['prompt_runs', 'ai_tokens', 'crawl_pages', 'users', 'brands']
    for (const metric of metrics) {
      expect(body).toHaveProperty(metric)
      expect(typeof body[metric].used).toBe('number')
      expect(typeof body[metric].limit).toBe('number')
    }
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/orgs/billing-org/billing/usage')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/orgs/:slug/billing/checkout', () => {
  it('returns 200 with null checkoutUrl when Stripe is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await app.request('/api/orgs/billing-org/billing/checkout', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        plan: 'starter',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.checkoutUrl).toBeNull()
    expect(body.message).toBe('Stripe not configured')
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/orgs/billing-org/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: 'starter',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/orgs/:slug/billing/webhooks', () => {
  it('returns 200 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const res = await app.request('/api/orgs/billing-org/billing/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'customer.subscription.created' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.received).toBe(true)
  })
})

describe('GET /api/orgs/:slug/billing/portal', () => {
  it('returns null portalUrl when no Stripe customer exists', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await app.request('/api/orgs/billing-org/billing/portal', {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.portalUrl).toBeNull()
  })
})
