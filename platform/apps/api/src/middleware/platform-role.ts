import type { MiddlewareHandler } from 'hono';
import { db } from '@bebest/database';
import { getDefaultErrorTracker } from '../lib/observability/default-error-tracker.js';
import type { AppEnv, PlatformRole } from '../types/context.js';

/**
 * Epic 22 — the gate in front of every cross-tenant Platform API route
 * (`/api/platform/*`). Must run AFTER `requireAuth`.
 *
 * 1. Re-reads `users.platform_role` from the database on EVERY request.
 *    Never from the token, never cached: SECURITY.md's "never rely on a
 *    client-sent role" applies doubly to the one role that reaches across
 *    tenants, and revoking a staff grant has to bite on the very next
 *    request, not when a token expires.
 * 2. Refuses anything below `min` with 403 — and writes nothing, so a
 *    customer probing `/api/platform/*` leaves no rows behind.
 * 3. Writes one `platform_access_events` row BEFORE the handler runs, reads
 *    included.
 *
 * WHY AN AUDIT FAILURE FAILS THE REQUEST
 *
 * `writeAuditEvent` (lib/audit.ts) deliberately swallows its own failures:
 * there, the audited action is the customer's own work inside their own
 * org, and an audit hiccup must not break it. This is the opposite case.
 * The action here is BeBest staff reading OTHER organizations' data, and
 * the access log is the control that makes that acceptable — the only
 * record a customer (or we) can ever be shown of who looked at what. Access
 * that cannot be recorded is access that does not happen: a failed write
 * answers 500 and the handler never runs.
 *
 * Target ids come from route params — by default `orgId`/`organizationId`
 * and `userId`; a route whose param is named differently (e.g.
 * `/orgs/:id`) says so via `options`. A value that is not a UUID is not
 * recorded as a target (the path still is); one that names no row fails
 * the foreign key, and the write is retried once without targets rather
 * than turning "no such org" into a 500 — `request_path` still carries
 * the id that was asked for.
 */

const RANK: Record<PlatformRole, number> = { none: 0, support: 1, admin: 2 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlatformRoleOptions {
  /** Route param holding the organization this request is about. */
  targetOrgParam?: string;
  /** Route param holding the user this request is about. */
  targetUserParam?: string;
}

/** Unknown or missing values read as `none` — fail closed. */
export function parsePlatformRole(value: unknown): PlatformRole {
  return value === 'support' || value === 'admin' ? value : 'none';
}

export function hasPlatformRole(actual: PlatformRole, min: Exclude<PlatformRole, 'none'>): boolean {
  return RANK[actual] >= RANK[min];
}

function uuidOrNull(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function isForeignKeyViolation(err: unknown): boolean {
  // Prisma surfaces a driver-adapter FK failure as P2003; the raw SQLSTATE
  // may also be on the error or its cause.
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === 'P2003' || e?.code === '23503' || e?.cause?.code === '23503';
}

export function requirePlatformRole(
  min: Exclude<PlatformRole, 'none'>,
  options: PlatformRoleOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    // `users` is not under RLS (0000_init/rls.sql), so the un-scoped client
    // is correct here — same reasoning as `requireAuth`'s own lookup.
    const row = await db.users.findUnique({
      where: { id: user.id },
      select: { platform_role: true, deleted_at: true },
    });
    const role = row && !row.deleted_at ? parsePlatformRole(row.platform_role) : 'none';

    if (role === 'none' || !hasPlatformRole(role, min)) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'platform_access_denied',
          userId: user.id,
          required: min,
          actual: role,
          method: c.req.method,
          path: c.req.path,
        }),
      );
      return c.json({ error: 'Platform access required' }, 403);
    }

    const params = c.req.param() as Record<string, string | undefined>;
    const targetOrgId = uuidOrNull(
      options.targetOrgParam ? params[options.targetOrgParam] : (params.orgId ?? params.organizationId),
    );
    const targetUserId = uuidOrNull(options.targetUserParam ? params[options.targetUserParam] : params.userId);

    const event = {
      user_id: user.id,
      platform_role: role,
      action: `${c.req.method} ${c.req.routePath}`.slice(0, 100),
      target_org_id: targetOrgId,
      target_user_id: targetUserId,
      request_path: c.req.path,
      method: c.req.method,
    };

    try {
      // `createMany`, not `create`: the table's only RLS policy is INSERT
      // (0023_workspace_views/rls.sql), and `create` adds `RETURNING`, which
      // Postgres checks against SELECT policies — there are none, by design.
      try {
        await db.platform_access_events.createMany({ data: [event] });
      } catch (err) {
        if (!isForeignKeyViolation(err) || (!targetOrgId && !targetUserId)) throw err;
        await db.platform_access_events.createMany({
          data: [{ ...event, target_org_id: null, target_user_id: null }],
        });
      }
    } catch (err) {
      getDefaultErrorTracker().captureException(err, {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        userId: user.id,
      });
      return c.json({ error: 'Platform access could not be audited' }, 500);
    }

    c.set('platformRole', role);
    await next();
  };
}
