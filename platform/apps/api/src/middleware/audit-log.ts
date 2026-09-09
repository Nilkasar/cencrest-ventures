import type { MiddlewareHandler } from 'hono';
import { writeAuditEvent } from '../lib/audit.js';
import { clientIp } from '../lib/client-ip.js';
import type { AppEnv } from '../types/context.js';

export interface AuditLogOptions {
  action: string;
  entityType: string;
  /** How to pull the affected entity's id off the request/response.
   * Defaults to the route's `:id` param, then the acting user's id for
   * user-entity events (login/logout, where the user IS the entity), and
   * finally `null` when there genuinely is no entity — see
   * `resolveEntityId` below. */
  getEntityId?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string | null | undefined;
  actorType?: 'user' | 'system' | 'agent';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `audit_events.entity_id` is a UUID column. This used to fall back to the
 * literal string `'unknown'`, which Postgres rejects outright (`22P02
 * invalid input syntax for type uuid`) — and because `writeAuditEvent`
 * deliberately swallows its own failures so an audit write can never break
 * the action it records, the result was silent: every audited action on a
 * route with no `:id` param (login, logout, billing webhooks, and the
 * keyword/query routes whose param is named something else) completed
 * normally while writing NO audit row at all. For a system whose
 * SECURITY.md requires an audit trail for privileged actions, a trail with
 * invisible holes in it is worse than a loud failure.
 *
 * So: resolve a real id where one exists, fall back to the acting user for
 * events whose entity IS the user, and otherwise write NULL — which the
 * column now permits. Anything that isn't a UUID is dropped rather than
 * handed to the database.
 */
function resolveEntityId(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  opts: AuditLogOptions,
  userId: string | null,
): string | null {
  const candidate = opts.getEntityId?.(c) ?? c.req.param('id') ?? null;
  if (candidate && UUID_RE.test(candidate)) return candidate;
  if (opts.entityType === 'user' && userId) return userId;
  return null;
}

/**
 * Attach to any route that performs a privileged action
 * (docs/08-security/SECURITY.md's "Actions that ALWAYS generate audit
 * log" list — see lib/audit.ts's `ALWAYS_AUDITED_ACTIONS`) to record it
 * automatically, so the handler itself never has to remember to call
 * `writeAuditEvent`. Must run AFTER `requireAuth` (and, for org-scoped
 * actions, after tenant-context) so `c.get('user')`/`c.get('org')` are
 * available — both are read defensively (never assumed present) so this
 * middleware also works on routes like login/logout where there may be no
 * org, or the user isn't known until the handler runs.
 *
 * Logs `result: 'success'` for any 2xx/3xx response and `'failure'`
 * otherwise, AFTER the handler has run — so the log reflects what actually
 * happened, not just that the request was attempted.
 */
export function auditLog(opts: AuditLogOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    const user = safeGet(c, 'user');
    const org = safeGet(c, 'org');
    const entityId = resolveEntityId(c, opts, user?.id ?? null);
    const success = c.res.status < 400;

    await writeAuditEvent({
      userId: user?.id ?? null,
      organizationId: org?.organizationId ?? null,
      actorType: opts.actorType ?? 'user',
      actorRole: org?.role ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId,
      // `ip_address` is an INET column: the raw header can be a
      // comma-separated proxy chain, which Postgres rejects. See
      // lib/client-ip.ts.
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      result: success ? 'success' : 'failure',
      details: { path: c.req.path, method: c.req.method, status: c.res.status },
    });
  };
}

// `c.get()` throws in some Hono versions when a variable was never `set()`
// on this request (e.g. a failed-auth login attempt never sets `user`).
// This wrapper turns that into `undefined` instead of crashing the audit
// middleware itself.
function safeGet<K extends 'user' | 'org'>(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  key: K,
): AppEnv['Variables'][K] | undefined {
  try {
    return c.get(key);
  } catch {
    return undefined;
  }
}

export interface ManualAuditEventOptions {
  action: string;
  entityType: string;
  entityId: string | null;
  result?: 'success' | 'failure';
  actorType?: 'user' | 'system' | 'agent';
}

/**
 * For the routes `auditLog` (above) can't cover: a POST that creates a new
 * row has no `:id` in its URL for the middleware's default `getEntityId` to
 * read, so the entity id is only known AFTER the handler runs and only to
 * the handler itself. Call this directly from inside such a handler, right
 * after the row is created, instead of stretching `auditLog`'s
 * `getEntityId` callback to reach into response state it was never given.
 * Same underlying `writeAuditEvent` call, same user/org/ip/user-agent
 * extraction as the middleware above — just invoked with an id the caller
 * already has in hand.
 */
export async function writeManualAuditEvent(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  opts: ManualAuditEventOptions,
): Promise<void> {
  const user = safeGet(c, 'user');
  const org = safeGet(c, 'org');

  await writeAuditEvent({
    userId: user?.id ?? null,
    organizationId: org?.organizationId ?? null,
    actorType: opts.actorType ?? 'user',
    actorRole: org?.role ?? null,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId,
    ipAddress: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    result: opts.result ?? 'success',
    details: { path: c.req.path, method: c.req.method },
  });
}
