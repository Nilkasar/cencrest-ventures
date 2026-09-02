import type { Context, MiddlewareHandler } from 'hono';
import { checkRateLimit } from '../lib/rate-limiter.js';
import type { AppEnv } from '../types/context.js';

export interface RateLimitMiddlewareOptions {
  bucket: string;
  max: number;
  windowSeconds: number;
  /** How to derive the per-caller key. Defaults to the client IP. */
  keyFn?: (c: Context<AppEnv>) => string;
  /** If true, attaches `organization_id` to the stored row when
   * `c.get('org')` is available (set this on routes that run after
   * tenant-context middleware). Purely for reporting — the key itself
   * already encodes the caller. */
  attachOrg?: boolean;
}

function defaultKey(c: Context<AppEnv>): string {
  return c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Durable rate limiting, matching the table in
 * docs/08-security/SECURITY.md. Backed by `organization_rate_limits`
 * (@bebest/database) — see lib/rate-limiter.ts for the storage design and
 * why this table is not RLS-protected.
 *
 * Pre-built limiters below match SECURITY.md's table exactly; compose a
 * custom one with `rateLimit({...})` for anything else.
 */
export function rateLimit(opts: RateLimitMiddlewareOptions): MiddlewareHandler<AppEnv> {
  const keyFn = opts.keyFn ?? defaultKey;

  return async (c, next) => {
    let organizationId: string | undefined;
    if (opts.attachOrg) {
      try {
        organizationId = c.get('org')?.organizationId;
      } catch {
        organizationId = undefined;
      }
    }

    const result = await checkRateLimit({
      bucket: opts.bucket,
      key: keyFn(c),
      max: opts.max,
      windowSeconds: opts.windowSeconds,
      organizationId,
    });

    c.header('X-RateLimit-Limit', String(result.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.resetAt));

    if (!result.allowed) {
      const retryAfter = Math.max(0, result.resetAt - Math.floor(Date.now() / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests', retryAfter }, 429);
    }

    return next();
  };
}

// Pre-built limiters matching docs/08-security/SECURITY.md's rate-limit table.
export const publicRateLimit = rateLimit({ bucket: 'public', max: 30, windowSeconds: 60 });
export const authRateLimit = rateLimit({ bucket: 'auth', max: 5, windowSeconds: 15 * 60 });
export const freeSnapshotRateLimit = rateLimit({
  bucket: 'free_snapshot',
  max: 1,
  windowSeconds: 60 * 60,
});
export const authenticatedRateLimit = rateLimit({
  bucket: 'authenticated',
  max: 120,
  windowSeconds: 60,
  keyFn: (c) => {
    try {
      return c.get('user')?.id ?? defaultKey(c);
    } catch {
      return defaultKey(c);
    }
  },
});
export const aiQueryRateLimit = rateLimit({
  bucket: 'ai_query',
  max: 10,
  windowSeconds: 60,
  attachOrg: true,
  keyFn: (c) => {
    try {
      return c.get('org')?.organizationId ?? defaultKey(c);
    } catch {
      return defaultKey(c);
    }
  },
});
export const adminRateLimit = rateLimit({ bucket: 'admin', max: 30, windowSeconds: 60 });
