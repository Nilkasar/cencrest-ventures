import type { MiddlewareHandler } from 'hono';
import { writeAuditEvent } from '../lib/audit.js';
import type { AppEnv } from '../types/context.js';

export interface AuditLogOptions {
  action: string;
  entityType: string;
  /** How to pull the affected entity's id off the request/response.
   * Defaults to the route's `:id` param if present, else 'unknown'. */
  getEntityId?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string;
  actorType?: 'user' | 'system' | 'agent';
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
    const entityId = opts.getEntityId?.(c) ?? c.req.param('id') ?? 'unknown';
    const success = c.res.status < 400;

    await writeAuditEvent({
      userId: user?.id ?? null,
      organizationId: org?.organizationId ?? null,
      actorType: opts.actorType ?? 'user',
      actorRole: org?.role ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId,
      ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
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
