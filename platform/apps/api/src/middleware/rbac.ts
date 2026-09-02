import type { MiddlewareHandler } from 'hono';
import { hasPermission, type Action, type PermissionCheckOptions } from '../lib/rbac.js';
import type { AppEnv } from '../types/context.js';

/**
 * Enforces one specific permission from the SECURITY.md matrix
 * (lib/rbac.ts's `PERMISSION_MATRIX`). Must run after tenant-context
 * middleware (`requireOrgBySlug`/`requireOrgFromToken`), which is what
 * guarantees `c.get('org').role` is fresh from the database.
 *
 * Use this instead of (or in addition to) `requireOrgBySlug`/
 * `requireOrgFromToken`'s `minRole` parameter whenever the check is about
 * a SPECIFIC action rather than a role-seniority threshold — e.g.
 * "can publish content" is not the same question as "is at least an
 * editor," because an owner-only action (`manage_billing`) has nothing to
 * do with the editor/analyst tier.
 */
export function requirePermission(
  action: Action,
  resolveOpts?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => PermissionCheckOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const org = c.get('org');
    if (!org) {
      // Should never happen if middleware is wired correctly, but fail
      // closed rather than throwing a confusing 500.
      return c.json({ error: 'Forbidden' }, 403);
    }

    const opts = resolveOpts?.(c) ?? {};
    if (!hasPermission(org.role, action, opts)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    return next();
  };
}
