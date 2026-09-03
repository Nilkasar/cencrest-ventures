/**
 * Epic 18 (Agency / White Label / Integrations) — the ONE authorization
 * check that gates "does this user get to assert client org X's id at
 * all," composing with (never replacing) Epic 0's tenant-context machinery.
 *
 * The epic brief's own words: "a request 'acting as' a client org still
 * goes through the exact same `withOrgContext(clientOrgId, ...)` mechanism
 * Epic 0 built — the only new logic is an authorization check... gating
 * which `organization_id` a request is allowed to assert, not a change to
 * how RLS itself works." This module is that authorization check, and
 * nothing else — it never queries a tenant table directly, never bypasses
 * RLS, and is consumed by exactly two call sites (both wired to compose,
 * not replace, per that same instruction):
 *   - `middleware/tenant-context.ts`'s `resolveOrgContext` — the function
 *     EVERY tenant-table request already re-resolves org context through,
 *     so a revoked link is caught on the very next request, never cached.
 *   - `routes/auth.ts`'s `POST /select-org` — so an agency user can obtain
 *     an org-scoped access token for a client org at all (the JWT's `org`
 *     claim is only ever a HINT per `types/context.ts`'s `AuthUser` doc
 *     comment — `resolveOrgContext` re-verifies this exact same check on
 *     every subsequent request regardless of what the token claims).
 *
 * Fails closed at every branch: no membership anywhere → null; membership
 * but no link → null; a link that exists but isn't `status: 'active'`
 * (`pending`, `paused`, `terminated`, `revoked`) → null. There is no
 * "cache" of a prior grant anywhere in this module — every call re-reads
 * `agency_clients` fresh, which is the literal mechanism behind the DoD's
 * "revoking a link immediately blocks a subsequent request" requirement.
 */

import { withUserContext, withOrgContext, type role } from '@bebest/database';
import { lowerRankRole } from './rbac.js';

/** `agency_clients.access_level`'s closed vocabulary (see
 * `0000_init/checks.sql`'s `chk_agency_clients_access_level`), mapped onto
 * the platform's real `role` enum — the seam that lets everything
 * downstream (`isAtLeast`, `hasPermission`, `requirePermission`) treat an
 * agency-mediated request exactly like a direct membership, no special
 * casing required anywhere else. Fails toward the LEAST privileged role
 * (`viewer`) for any value outside the known three, never toward more
 * access than a malformed/legacy row can prove it was granted. */
export function accessLevelToRole(accessLevel: string): role {
  switch (accessLevel) {
    case 'full':
      return 'admin';
    case 'limited':
      return 'analyst';
    case 'read_only':
      return 'viewer';
    default:
      return 'viewer';
  }
}

/** The inverse mapping, for `routes/agency.ts`'s invite endpoint (an agency
 * admin picks a `role` to grant; the table stores `access_level`). Only the
 * three roles `accessLevelToRole` can ever produce round-trip cleanly —
 * `routes/agency.ts`'s own validation schema restricts the invite body to
 * exactly these three for that reason. */
export function roleToAccessLevel(r: 'admin' | 'analyst' | 'viewer'): 'full' | 'limited' | 'read_only' {
  switch (r) {
    case 'admin':
      return 'full';
    case 'analyst':
      return 'limited';
    case 'viewer':
      return 'read_only';
  }
}

export interface AgencyAccess {
  /** The role the agency user should be treated as within the client
   * org's data for this request — already capped by the agency user's own
   * rank in their agency org (see this function's body). */
  role: role;
  /** Which of the user's own orgs the grant came through — surfaced on
   * `OrgContext.viaAgencyOrgId` so audit logs and route handlers can tell
   * an agency-mediated request apart from a direct membership one. */
  agencyOrgId: string;
  /** The specific `agency_clients` row id this access was resolved from —
   * for tracing/debugging, not itself a trust boundary (the row is
   * re-read fresh on every call, never cached by this id). */
  linkId: string;
}

/**
 * Resolves whether `userId` may act as `clientOrgId` through an active
 * agency relationship, given they have NO direct membership in that org
 * (callers check direct membership first — see `resolveOrgContext`).
 *
 * Walks every org `userId` IS a direct member of (there is normally
 * exactly one "the agency" org, but this doesn't assume that) and asks, for
 * each: does THIS org have an active `agency_clients` link to
 * `clientOrgId`? The first match wins. Each `agency_clients` read goes
 * through `withOrgContext(candidateAgencyOrgId, ...)`, which satisfies that
 * table's own RLS policy (`agency_org_id = current_org` — see
 * `@bebest/database`'s rls.sql "Special case — agency_clients") without
 * ever touching `withOrgContext(clientOrgId, ...)` — this function never
 * asserts the CLIENT org's id against RLS itself; it only ever proves
 * whether doing so downstream would be authorized.
 */
export async function resolveAgencyAccess(
  userId: string,
  clientOrgId: string,
): Promise<AgencyAccess | null> {
  const memberships = await withUserContext(userId, (tx) =>
    tx.memberships.findMany({ where: { user_id: userId } }),
  );

  for (const membership of memberships) {
    const candidateAgencyOrgId = membership.organization_id;
    if (candidateAgencyOrgId === clientOrgId) continue; // never act "as" your own org via this path

    const link = await withOrgContext(candidateAgencyOrgId, (tx) =>
      tx.agency_clients.findFirst({
        where: {
          agency_org_id: candidateAgencyOrgId,
          client_org_id: clientOrgId,
          status: 'active',
          deleted_at: null,
        },
      }),
    );
    if (!link) continue;

    const grantedRole = accessLevelToRole(link.access_level);
    // Defense in depth: an agency's contractual access to a client is
    // never a way for one of the agency's OWN low-privilege members to
    // reach higher privilege than they hold at the agency itself.
    const effectiveRole = lowerRankRole(grantedRole, membership.role);

    return { role: effectiveRole, agencyOrgId: candidateAgencyOrgId, linkId: link.id };
  }

  return null;
}
