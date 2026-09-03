import type { role } from '@bebest/database';

/**
 * The authenticated caller, as established by `requireAuth`. Only what
 * came from a verified access token / DB lookup — never anything
 * client-supplied and untrusted.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** `org` claim from the access token, if one was selected at issuance.
   * This is a HINT for which org to resolve tenant context for — it is
   * NEVER used for authorization by itself. `tenant-context` middleware
   * re-verifies membership (and re-reads the role) from the database on
   * every request. See docs/08-security/SECURITY.md: "Never rely on
   * client-sent role — always read from database." */
  tokenOrgId: string | null;
}

/**
 * The resolved, DB-verified tenant context for the current request. Set by
 * `tenant-context` middleware AFTER re-checking the caller's membership —
 * `role` here is always fresh from `memberships`, never from the JWT.
 */
export interface OrgContext {
  organizationId: string;
  name: string;
  slug: string;
  role: role;
  /** Epic 18 (Agency / White Label / Integrations) — set ONLY when this
   * context was resolved via an `agency_clients` link rather than a direct
   * `memberships` row (see `middleware/tenant-context.ts`'s
   * `resolveOrgContext` and `lib/agency-access.ts`). Absent (not merely
   * `null`) for the normal direct-membership case, so existing equality
   * assertions in Epic 0's own test suite comparing a full `OrgContext`
   * object are unaffected by this addition. Carries the id of the agency
   * org the access came through — never used for authorization itself
   * (that already happened before this context was constructed), only for
   * audit-trail and response transparency. */
  viaAgencyOrgId?: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    user: AuthUser;
    org: OrgContext;
  };
};
