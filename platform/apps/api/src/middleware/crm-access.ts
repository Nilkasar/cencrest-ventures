import type { MiddlewareHandler } from 'hono';
import { db, type role } from '@bebest/database';
import { requireOrgFromToken } from './tenant-context.js';
import { parsePlatformRole } from './platform-role.js';
import { getInternalOrgId, MissingInternalOrgConfigError } from '../lib/internal-org.js';
import { isAtLeast } from '../lib/rbac.js';
import type { AppEnv, PlatformRole } from '../types/context.js';

/**
 * Epic 1 (CRM) tenant gate. CRM is an internal/ops tool in v1
 * (docs/epics/01-crm.md's Entitlements section) — access is controlled
 * purely by the caller's role within the internal BeBest operations org,
 * never a customer's own org. Composes on top of `requireOrgFromToken`
 * (which does the real work: re-verifying membership + role from the
 * database) and adds one more check on top — that the org the caller's
 * token resolved to IS the internal org, not just any org they happen to
 * belong to.
 *
 * Epic 22 Phase 1 — a SECOND way in: BeBest platform staff
 * (`users.platform_role` support/admin, re-read from the database here on
 * every request, never from the token) may use the CRM from the Platform
 * view whatever org their token currently has selected — they are the
 * people who work leads, and making them switch into the ops org first was
 * the friction the Platform view exists to remove. Nothing about WHERE the
 * data lives changes: the org context set below is still the internal org,
 * and every CRM handler still scopes its queries with
 * `withOrgContext(getInternalOrgId(), ...)` on the request role — staff do
 * NOT get `platformDb` here. Staff act with a fixed CRM role derived from
 * their platform role (`STAFF_CRM_ROLE`), so `requirePermission` downstream
 * still decides what they may do.
 *
 * Order: a caller whose token already selects the internal org goes
 * through the original membership path untouched (no extra query). Anyone
 * else gets one `users` lookup; staff are let in, everyone else falls
 * through to the original path, which answers exactly as before (409 no
 * org selected / 403 not the internal org / 403 not a member).
 *
 * A route still layers `requirePermission('manage_leads' | 'manage_deals' |
 * 'log_crm_activities')` on top of this for the entity-specific part of the
 * matrix (`view_crm`'s `minRole: 'viewer'` here only proves internal-org
 * membership, not what that role may DO).
 */

/** The CRM role platform staff act with. `support` works the pipeline
 * (`analyst`: manage leads/deals, log activities); `admin` additionally
 * gets the internal org's admin rights. Neither is ever `owner`. */
const STAFF_CRM_ROLE: Record<Exclude<PlatformRole, 'none'>, role> = {
  support: 'analyst',
  admin: 'admin',
};

export function requireCrmAccess(minRole: role = 'viewer'): MiddlewareHandler<AppEnv> {
  const resolveOrg = requireOrgFromToken(minRole);

  return async (c, next) => {
    let internalOrgId: string;
    try {
      internalOrgId = getInternalOrgId();
    } catch (err) {
      if (err instanceof MissingInternalOrgConfigError) {
        return c.json({ error: 'CRM is not configured on this server' }, 500);
      }
      throw err;
    }

    const user = c.get('user');
    if (user.tokenOrgId !== internalOrgId) {
      const staff = await db.users.findUnique({
        where: { id: user.id },
        select: { platform_role: true, deleted_at: true },
      });
      const platformRole = staff && !staff.deleted_at ? parsePlatformRole(staff.platform_role) : 'none';
      if (platformRole !== 'none') {
        // `organizations` has no RLS; same un-scoped read `requireOrgFromToken` makes.
        const internalOrg = await db.organizations.findUnique({ where: { id: internalOrgId } });
        if (!internalOrg || internalOrg.deleted_at) {
          return c.json({ error: 'CRM is not configured on this server' }, 500);
        }
        const crmRole = STAFF_CRM_ROLE[platformRole];
        if (!isAtLeast(crmRole, minRole)) {
          return c.json({ error: 'Insufficient permissions' }, 403);
        }
        c.set('org', {
          organizationId: internalOrg.id,
          name: internalOrg.name,
          slug: internalOrg.slug,
          role: crmRole,
        });
        c.set('platformRole', platformRole);
        return next();
      }
    }

    // `next` passed to `resolveOrg` here plays the role of Hono's `Next`
    // type (`() => Promise<void>`), which cannot return a Response — so the
    // 403 short-circuit below finalizes the response via the `c.res`
    // SETTER (which also flips `c.finalized`), not by merely calling
    // `c.json(...)` and discarding its return value (that constructs a
    // Response but does not, by itself, attach it to the context — see
    // hono's Context#newResponse).
    return resolveOrg(c, async () => {
      const org = c.get('org');
      if (org.organizationId !== internalOrgId) {
        c.res = c.json(
          { error: 'CRM access requires selecting the internal operations organization' },
          403,
        );
        return;
      }
      await next();
    });
  };
}
