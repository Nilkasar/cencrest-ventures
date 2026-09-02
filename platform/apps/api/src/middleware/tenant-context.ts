import type { MiddlewareHandler } from 'hono';
import { db, withUserContext, type role } from '@bebest/database';
import { isAtLeast } from '../lib/rbac.js';
import type { AppEnv, OrgContext } from '../types/context.js';

/**
 * Tenant-context resolution — the ONE place that turns "a user and an
 * organization id" into a DB-verified `OrgContext`. Both middlewares below
 * (`requireOrgBySlug`, `requireOrgFromToken`) call this; nothing else
 * should query `memberships` directly.
 *
 * `role` here is ALWAYS read fresh from the `memberships` table in this
 * call — never passed in, never trusted from a token or a prior request.
 * This is the concrete implementation of SECURITY.md's "Never rely on
 * client-sent role — always read from database."
 *
 * Looking up `memberships` requires `app.current_user` (not
 * `app.current_org`) to be set — see @bebest/database's rls.sql
 * "Special case — memberships" and DECISIONS.md §7a for why that table's
 * RLS policy is keyed differently from every other tenant table.
 */
async function resolveOrgContext(
  userId: string,
  organizationId: string,
): Promise<OrgContext | null> {
  const org = await db.organizations.findUnique({ where: { id: organizationId } });
  if (!org || org.deleted_at) return null;

  const membership = await withUserContext(userId, (tx) =>
    tx.memberships.findFirst({ where: { organization_id: organizationId, user_id: userId } }),
  );
  if (!membership) return null;

  return {
    organizationId: org.id,
    name: org.name,
    slug: org.slug,
    role: membership.role,
  };
}

/**
 * Resolves tenant context from a `:slug` route param (e.g.
 * `/api/orgs/:slug`, `/api/orgs/:slug/members`). Must run after
 * `requireAuth`. This is the primary tenant-context middleware for
 * human-facing, URL-addressed organization resources.
 */
export function requireOrgBySlug(minRole: role = 'viewer'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const slug = c.req.param('slug');
    if (!slug) return c.json({ error: 'Organization slug required' }, 400);

    const user = c.get('user');
    const org = await db.organizations.findUnique({ where: { slug } });
    if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404);

    const context = await resolveOrgContext(user.id, org.id);
    if (!context) return c.json({ error: 'Forbidden' }, 403);
    if (!isAtLeast(context.role, minRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    c.set('org', context);
    return next();
  };
}

/**
 * Resolves tenant context from the access token's `org` claim, for routes
 * that don't carry an org slug in the URL. This is the literal
 * "tenant-context middleware: extracts org claim from the validated JWT"
 * deliverable — every tenant-table query for the rest of the request
 * should be scoped with `withOrgContext(c.get('org').organizationId, ...)`
 * from `@bebest/database`, which this middleware's DB-verified role makes
 * safe to trust.
 *
 * If the caller's token has no `org` claim yet (they haven't selected an
 * organization since logging in — see routes/auth.ts `select-org`), this
 * responds 409 rather than 401/403: the caller IS authenticated, they just
 * haven't completed the "pick a workspace" step yet.
 */
export function requireOrgFromToken(minRole: role = 'viewer'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user.tokenOrgId) {
      return c.json({ error: 'No organization selected. Call /api/auth/select-org first.' }, 409);
    }

    const context = await resolveOrgContext(user.id, user.tokenOrgId);
    if (!context) {
      // Membership was revoked (or the org deleted) since the token was
      // issued. Fail closed rather than falling back to any cached value.
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (!isAtLeast(context.role, minRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    c.set('org', context);
    return next();
  };
}
