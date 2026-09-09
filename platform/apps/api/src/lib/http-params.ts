/**
 * Route parameter parsing.
 *
 * Postgres `uuid` columns reject anything that isn't a UUID, and Prisma
 * surfaces that as a driver error rather than an empty result — so
 * `GET /leads/not-a-uuid` used to reach `findFirst({ where: { id } })` and
 * come back as a **500**, on every `:id` route in the CRM. A malformed
 * identifier is not a server fault; it is simply a record that cannot
 * exist.
 *
 * These helpers make that explicit at the top of a handler, before any
 * query runs.
 */
import type { Context } from 'hono';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * The named route param, or `null` when it is missing or not a UUID.
 *
 * Callers answer `null` with the same 404 they use for an id that simply
 * doesn't exist: from the caller's side the two are indistinguishable, and
 * responding differently would confirm which identifier shapes are real.
 */
export function uuidParam(c: Context, name: string): string | null {
  const value = c.req.param(name);
  return isUuid(value) ? value : null;
}
