/**
 * Durable, Postgres-backed rate limiting — replaces the previous
 * implementation's in-memory `Map` (see api/src/middleware/rate-limit.ts),
 * which was explicitly called out there as "Replace with Redis/pg-based in
 * production" technical debt. This is that replacement.
 *
 * Backed by `organization_rate_limits` (@bebest/database), a fixed-window
 * counter table. It is intentionally NOT behind Row-Level Security — see
 * that table's comment in `rls.sql` and @bebest/database/DECISIONS.md §7a:
 * rate limiting has to work for anonymous, pre-auth requests (no tenant
 * context exists yet), and RLS would make those checks silently
 * ineffective. Safety instead comes from each caller only ever being able
 * to construct its OWN bucket key.
 *
 * Algorithm: fixed window. `windowStart` is the request time truncated
 * down to a `windowSeconds` boundary, so all requests within the same
 * window collapse onto the same row via a single atomic upsert
 * (`count: { increment: 1 }`), which is safe under concurrent requests —
 * Postgres serializes the upsert per row.
 *
 * Fixed-window has a known edge case (up to ~2x the limit can pass across
 * a window boundary). That is an acceptable, documented trade-off for a
 * rate limiter whose job is abuse/brute-force mitigation, not billing-grade
 * precision — a sliding-window-log implementation would need an unbounded
 * per-request-timestamp table, which is a much larger durability/cleanup
 * cost for marginal benefit here.
 */

import { db } from '@bebest/database';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Unix seconds when the current window resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Logical bucket name, e.g. "auth", "public", "ai_query". Combined with
   * `key` to form the stored `bucket_key`. */
  bucket: string;
  /** The caller-specific part of the key — an IP address, a user id, or an
   * organization id, depending on which table row in
   * docs/08-security/SECURITY.md's rate-limit table this check implements. */
  key: string;
  /** Max requests allowed per window. */
  max: number;
  windowSeconds: number;
  /** Only set when the bucket is genuinely tenant-scoped (e.g. the
   * "AI query endpoints" or "Authenticated general" rows) — recorded on
   * the row for observability/reporting. Anonymous buckets (public,
   * auth-by-IP, free-snapshot-by-IP) leave this undefined. */
  organizationId?: string;
}

function windowStartFor(date: Date, windowSeconds: number): Date {
  const epochSeconds = Math.floor(date.getTime() / 1000);
  const windowStartSeconds = epochSeconds - (epochSeconds % windowSeconds);
  return new Date(windowStartSeconds * 1000);
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = windowStartFor(now, opts.windowSeconds);
  const bucketKey = `${opts.bucket}:${opts.key}`;

  const row = await db.organization_rate_limits.upsert({
    where: { bucket_key_window_start: { bucket_key: bucketKey, window_start: windowStart } },
    create: {
      bucket_key: bucketKey,
      window_start: windowStart,
      window_seconds: opts.windowSeconds,
      count: 1,
      organization_id: opts.organizationId ?? null,
    },
    update: {
      count: { increment: 1 },
      updated_at: now,
    },
  });

  const resetAt = Math.floor(windowStart.getTime() / 1000) + opts.windowSeconds;

  return {
    allowed: row.count <= opts.max,
    remaining: Math.max(0, opts.max - row.count),
    limit: opts.max,
    resetAt,
  };
}
