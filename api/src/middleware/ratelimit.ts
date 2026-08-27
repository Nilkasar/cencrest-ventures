import type { MiddlewareHandler } from 'hono'

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store for local dev. Replace with Redis/pg-based in production.
const store = new Map<string, RateLimitEntry>()

export function rateLimit(opts: { max: number; windowMs: number }): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
    const key = `rl:${c.req.path}:${ip}`
    const now = Date.now()

    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs })
      return next()
    }

    if (entry.count >= opts.max) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    entry.count++
    return next()
  }
}
