import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireCrmAccess } from '../middleware/crm-access.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { loadUserRefs } from '../lib/crm-users.js';
import type { AppEnv } from '../types/context.js';

/**
 * Epic 1 (CRM) — the staff roster the assignee/owner pickers need.
 *
 * "CRM users" are simply the members of BeBest's internal operations org
 * (see lib/internal-org.ts), so this could in principle be assembled from
 * the existing org endpoints — and the CRM frontend used to do exactly
 * that: `GET /orgs`, then `GET /orgs/:slug/members` for each org until one
 * answered, because the client has no way to know which org is the
 * internal one. That is two serialized requests, plus a guess, to populate
 * a dropdown. This route answers the actual question in one call, and
 * `requireCrmAccess` already guarantees the caller is acting as the
 * internal org, so there is nothing to guess.
 */
const crmUsers = new Hono<AppEnv>();

crmUsers.get('/', requireAuth, authenticatedRateLimit, requireCrmAccess('viewer'), async (c) => {
  const internalOrgId = getInternalOrgId();

  // `memberships` RLS accepts either `app.current_user` or
  // `app.current_org` (0000_init/rls.sql, "Special case — memberships");
  // the org form is the one that returns every member, not just the caller.
  const memberships = await withOrgContext(internalOrgId, (tx) =>
    tx.memberships.findMany({
      where: { organization_id: internalOrgId },
      select: { user_id: true, role: true },
      orderBy: { created_at: 'asc' },
    }),
  );

  const refs = await loadUserRefs(memberships.map((m) => m.user_id));

  const data = memberships
    .map((membership) => {
      const user = refs.get(membership.user_id);
      if (!user) return null; // membership row outliving its user — skip, don't invent
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json({ data });
});

export default crmUsers;
