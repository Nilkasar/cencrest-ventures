import type { Context, MiddlewareHandler } from 'hono'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

export function rateLimit(options: {
  windowMs: number
  max: number
  keyFn?: (c: Context) => string
}): MiddlewareHandler {
  return async (c, next) => {
    const key = options.keyFn
      ? options.keyFn(c)
      : (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown')

    const now = Date.now()
    const { windowMs, max } = options

    let entry = store.get(key)

    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs }
      store.set(key, entry)
    } else if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('X-RateLimit-Limit', String(max))
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
      return c.json({ error: 'Too many requests', retryAfter }, 429)
    } else {
      entry.count++
    }

    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    return next()
  }
}

export const apiRateLimit = rateLimit({ windowMs: 60_000, max: 100 })
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 10 })
export const crawlRateLimit = rateLimit({ windowMs: 60_000, max: 5 })
