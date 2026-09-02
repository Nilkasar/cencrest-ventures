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
}

export type AppEnv = {
  Variables: {
    requestId: string;
    user: AuthUser;
    org: OrgContext;
  };
};
