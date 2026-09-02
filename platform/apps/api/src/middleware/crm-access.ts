import type { MiddlewareHandler } from 'hono';
import type { role } from '@bebest/database';
import { requireOrgFromToken } from './tenant-context.js';
import { getInternalOrgId, MissingInternalOrgConfigError } from '../lib/internal-org.js';
import type { AppEnv } from '../types/context.js';

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
 * A route still layers `requirePermission('manage_leads' | 'manage_deals' |
 * 'log_crm_activities')` on top of this for the entity-specific part of the
 * matrix (`view_crm`'s `minRole: 'viewer'` here only proves internal-org
 * membership, not what that role may DO).
 */
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
