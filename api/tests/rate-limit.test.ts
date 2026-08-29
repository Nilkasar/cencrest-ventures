import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../src/middleware/rate-limit.js'

const app = new Hono()
app.use('/test', rateLimit({ windowMs: 60_000, max: 3 }))
app.get('/test', (c) => c.json({ ok: true }))

describe('rateLimit middleware', () => {
  it('first 3 requests return 200', async () => {
    // Use unique IPs per test to avoid cross-test state contamination
    const ip = `10.0.1.${Math.floor(Math.random() * 200)}`
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test', { headers: { 'x-forwarded-for': ip } })
      expect(res.status).toBe(200)
    }
  })

  it('4th request returns 429 with error and retryAfter', async () => {
    const ip = `10.0.2.${Math.floor(Math.random() * 200)}`
    for (let i = 0; i < 3; i++) {
      await app.request('/test', { headers: { 'x-forwarded-for': ip } })
    }
    const res = await app.request('/test', { headers: { 'x-forwarded-for': ip } })
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Too many requests')
    expect(typeof body.retryAfter).toBe('number')
  })

  it('X-RateLimit-Remaining header decrements correctly', async () => {
    const ip = `10.0.3.${Math.floor(Math.random() * 200)}`

    const res1 = await app.request('/test', { headers: { 'x-forwarded-for': ip } })
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2')

    const res2 = await app.request('/test', { headers: { 'x-forwarded-for': ip } })
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1')

    const res3 = await app.request('/test', { headers: { 'x-forwarded-for': ip } })
    expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0')
  })
})
