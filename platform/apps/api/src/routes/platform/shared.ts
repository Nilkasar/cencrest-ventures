import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { authenticatedRateLimit } from '../../middleware/rate-limit.js';
import { requirePlatformRole, type PlatformRoleOptions } from '../../middleware/platform-role.js';
import type { AppEnv } from '../../types/context.js';

/**
 * Shared plumbing for Epic 22's cross-tenant Platform API
 * (`/api/platform/*`). Every route file in this folder builds its middleware
 * chain from `platformGuard` so no route can forget a step.
 */

export const PLATFORM_DB_UNCONFIGURED = { error: 'Platform database not configured' } as const;

/**
 * `PLATFORM_DATABASE_URL` unset → 503, not 500. Runs AFTER the role check
 * (a non-staff caller learns nothing about server configuration) and before
 * the handler touches `platformDb`, whose first use would otherwise throw
 * `PlatformDatabaseNotConfiguredError`. The platform router's `onError`
 * maps that error to the same 503 as a backstop.
 */
export const requirePlatformDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!process.env.PLATFORM_DATABASE_URL) return c.json(PLATFORM_DB_UNCONFIGURED, 503);
  await next();
};

/**
 * auth → per-user rate limit → `requirePlatformRole` (fresh role read +
 * one `platform_access_events` row) → platform DB configured. Pass
 * `{ needsDb: false }` for the one route that must answer without it
 * (`/capabilities`, which reports the missing database itself).
 */
export function platformGuard(
  min: 'support' | 'admin',
  options: PlatformRoleOptions & { needsDb?: boolean } = {},
): [MiddlewareHandler<AppEnv>, MiddlewareHandler<AppEnv>, MiddlewareHandler<AppEnv>, MiddlewareHandler<AppEnv>] {
  // A fixed-length tuple (pass-through in the last slot when the DB is not
  // needed) so Hono's typed `get(path, ...handlers)` overloads accept the spread.
  const { needsDb = true, ...roleOptions } = options;
  return [requireAuth, authenticatedRateLimit, requirePlatformRole(min, roleOptions), needsDb ? requirePlatformDb : passThrough];
}

const passThrough: MiddlewareHandler<AppEnv> = async (_c, next) => {
  await next();
};

// ── Pagination ───────────────────────────────────────────────────────────

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
/** Deep offsets are an anti-pattern on these tables (every one is an
 * append-heavy log or a growing list); staff narrow with filters instead. */
export const MAX_OFFSET = 10_000;

export interface Page {
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const intParam = z
  .string()
  .regex(/^\d{1,9}$/, 'must be a non-negative integer')
  .transform(Number);

/**
 * `limit`/`offset` from the query string. A value above the cap is CLAMPED
 * (`limit=500` → 100) rather than rejected, so a client can ask for "as
 * many as you'll give me"; a value that is not a non-negative integer is a
 * 422. The response always echoes the limit/offset actually applied.
 */
export function parsePage(c: Context): Page | { error: string } {
  const rawLimit = c.req.query('limit');
  const rawOffset = c.req.query('offset');
  const limit = rawLimit === undefined || rawLimit === '' ? { success: true as const, data: DEFAULT_LIMIT } : intParam.safeParse(rawLimit);
  const offset = rawOffset === undefined || rawOffset === '' ? { success: true as const, data: 0 } : intParam.safeParse(rawOffset);
  if (!limit.success) return { error: 'limit must be a non-negative integer' };
  if (!offset.success) return { error: 'offset must be a non-negative integer' };
  return {
    limit: Math.min(Math.max(limit.data, 1), MAX_LIMIT),
    offset: Math.min(offset.data, MAX_OFFSET),
  };
}

export function isPageError(p: Page | { error: string }): p is { error: string } {
  return 'error' in p;
}

/** Optional trimmed search term, capped so a pasted essay is not a query. */
export function searchTerm(c: Context, name = 'q'): string | undefined {
  const value = c.req.query(name)?.trim();
  return value ? value.slice(0, 200) : undefined;
}

/**
 * Positional parameters for `$queryRawUnsafe`. `@bebest/database` exports
 * `Prisma` as a type only, so the tagged `Prisma.sql` helpers are not
 * available here; every user-supplied value still goes through a bind
 * parameter — the SQL text itself is only ever assembled from constants.
 */
export class SqlParams {
  readonly values: unknown[] = [];
  /** Adds a value and returns its placeholder (`$1`, `$2`, …). */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * One page plus the filtered total in ONE statement (one round trip): `f`
 * is the filtered set, `t` its count, and the page is a lateral slice of
 * `f` left-joined to `t` so the total survives an offset past the end.
 * `enrich` is an optional SELECT-list tail evaluated ONLY for the page's
 * rows (correlated subqueries over `p.*`) — per-row work stays bounded by
 * the page size, not by how many rows match the filter.
 */
export async function pagedQuery<T>(
  db: { $queryRawUnsafe<R>(sql: string, ...values: unknown[]): Promise<R> },
  params: SqlParams,
  page: Page,
  opts: { filtered: string; orderBy: string; enrich?: string },
): Promise<{ rows: T[]; total: number }> {
  const limitP = params.add(page.limit);
  const offsetP = params.add(page.offset);
  const sql = `WITH f AS (${opts.filtered}),
       t AS (SELECT count(*)::int AS n FROM f)
  SELECT t.n AS __total, p.*${opts.enrich ? `, ${opts.enrich}` : ''}
    FROM t
    LEFT JOIN LATERAL (SELECT * FROM f ORDER BY ${opts.orderBy} LIMIT ${limitP} OFFSET ${offsetP}) p ON true
   ORDER BY ${opts.orderBy}`;
  const rows = await db.$queryRawUnsafe<(T & { __total: number; id: string | null })[]>(sql, ...params.values);
  return {
    total: num(rows[0]?.__total),
    rows: rows.filter((r) => r.id !== null),
  };
}

/** `count(*)` comes back from raw SQL as a bigint on some drivers. */
export function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** A raw `json` column may arrive parsed or as text depending on the driver. */
export function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
