/**
 * RBAC — role hierarchy + the exact permission matrix from
 * docs/08-security/SECURITY.md, encoded as data (not scattered `if role ===`
 * checks in route handlers).
 *
 * Two complementary checks are exposed:
 *   - `isAtLeast(role, minRole)` — coarse hierarchy check for the common
 *     "must be at least admin" / "must be at least viewer (any member)"
 *     case. `analyst` and `editor` are the SAME rank (mid-tier) because the
 *     real matrix does not put one strictly above the other — they have
 *     different, non-overlapping permissions (see below), not a
 *     subset/superset relationship.
 *   - `hasPermission(role, action, opts)` — the actual per-action matrix
 *     from SECURITY.md. Use this whenever a route's authorization question
 *     is "can THIS role do THIS specific thing" rather than "is this role
 *     senior enough."
 *
 * `system` and `super_admin` are deliberately not part of the `role` enum
 * used here (see @bebest/database DECISIONS.md §9) — `system` never holds
 * a membership row (background jobs/agents authenticate differently, see
 * middleware/auth.ts), and `super_admin` is a platform-staff allowlist
 * check, not a per-org role, so it is out of scope for this
 * per-organization matrix.
 */

import type { role } from '@bebest/database';

const ROLE_RANK: Record<role, number> = {
  owner: 4,
  admin: 3,
  analyst: 2,
  editor: 2,
  viewer: 1,
  member: 2, // deprecated alias for analyst — see @bebest/database schema comment
};

export function isAtLeast(userRole: role, minRole: role): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}

/**
 * The lower-ranked of two roles — used by Epic 18's `lib/agency-access.ts`
 * to cap the role an agency link grants by the acting user's OWN rank in
 * their agency org, so a `viewer` at the agency never inherits a client
 * link's `full` (→`admin`) access just because the agency's contract with
 * that client is broad. `editor`/`analyst` are the same rank (see this
 * file's header comment) — when both inputs land on that tie, either is
 * returned (they're interchangeable for ranking purposes; ties never need
 * a determinstic pick because no caller branches on which specific name a
 * tie returns, only on rank comparisons downstream).
 */
export function lowerRankRole(a: role, b: role): role {
  return (ROLE_RANK[a] ?? 0) <= (ROLE_RANK[b] ?? 0) ? a : b;
}

/** @deprecated use {@link isAtLeast} — kept only because the original
 * implementation exposed this name and existing call sites may reference
 * it during the port. */
export const hasRole = isAtLeast;

export type Action =
  | 'view_intelligence'
  | 'create_brand_profile'
  | 'run_ai_analysis'
  | 'create_content_draft'
  | 'approve_content'
  | 'publish_content'
  | 'manage_integrations'
  | 'manage_billing'
  | 'manage_team'
  | 'delete_organization'
  | 'autonomous_actions'
  // Epic 1 (CRM) — docs/epics/01-crm.md's Entitlements section: "owner/
  // admin/analyst can create/edit; editor can log activities but not
  // manage deals; viewer read-only." `manage_leads` and `manage_deals` are
  // deliberately separate actions (not folded into one `manage_crm`) even
  // though today they share the exact same role list, because the spec
  // draws the line at the ENTITY, not a coarse "CRM" bucket — `editor`
  // already needs to fall on the "no" side of both while landing on "yes"
  // for `log_crm_activities`, which `isAtLeast`'s coarse rank check cannot
  // express (`analyst` and `editor` are the same hierarchy rank).
  | 'view_crm'
  | 'manage_leads'
  | 'manage_deals'
  | 'log_crm_activities'
  // Epic 18 (Agency / White Label / Integrations) — inviting/revoking a
  // client link is exactly the shape of privileged, cross-org-consequential
  // action `manage_team`/`manage_billing` already gate at owner/admin;
  // reusing `manage_integrations` (also owner/admin, but semantically about
  // a DIFFERENT resource — third-party connections, not client
  // relationships) would conflate two unrelated permission questions the
  // matrix keeps separate everywhere else (see this union's own header
  // comment on why `manage_leads`/`manage_deals` aren't folded into one
  // `manage_crm`).
  | 'manage_agency_clients';

/**
 * The permission matrix table, transcribed verbatim from
 * docs/08-security/SECURITY.md ("Permission Matrix (key operations)").
 * `system` and `super_admin` are handled by separate code paths (agents
 * run as `system` and are checked against SECURITY.md's "Autonomous Agent
 * Security" constraints, not this table; `super_admin` bypasses this table
 * entirely after its own allowlist check) — see middleware/rbac.ts.
 */
const PERMISSION_MATRIX: Record<Action, ReadonlyArray<role>> = {
  view_intelligence: ['owner', 'admin', 'analyst', 'editor', 'viewer'],
  create_brand_profile: ['owner', 'admin', 'analyst'],
  run_ai_analysis: ['owner', 'admin', 'analyst'],
  create_content_draft: ['owner', 'admin', 'analyst', 'editor'],
  // "editor (own)" in the doc means an editor may approve only drafts they
  // themselves authored — encoded via `opts.isOwnResource` below, not by
  // widening this list.
  approve_content: ['owner', 'admin', 'editor'],
  publish_content: ['owner', 'admin'],
  manage_integrations: ['owner', 'admin'],
  manage_billing: ['owner'],
  manage_team: ['owner', 'admin'],
  delete_organization: ['owner'],
  // "if enabled" in the doc refers to an org-level entitlement flag
  // (`organizations.settings.autonomyEnabled` or similar), checked
  // separately from role — this table only encodes the role half of the
  // condition. See TECHNICAL_DEBT-style note in apps/api/README.md.
  autonomous_actions: ['owner', 'admin'],
  // Epic 1 (CRM) — see the `Action` union above for why these are split
  // per-entity rather than one coarse `manage_crm`.
  view_crm: ['owner', 'admin', 'analyst', 'editor', 'viewer'],
  manage_leads: ['owner', 'admin', 'analyst'],
  manage_deals: ['owner', 'admin', 'analyst'],
  log_crm_activities: ['owner', 'admin', 'analyst', 'editor'],
  // Epic 18 — see the `Action` union above for why this is its own action.
  manage_agency_clients: ['owner', 'admin'],
};

export interface PermissionCheckOptions {
  /** Required for `approve_content`: an `editor` may approve only a draft
   * they authored themselves. Ignored for every other action. */
  isOwnResource?: boolean;
}

export function hasPermission(
  userRole: role,
  action: Action,
  opts: PermissionCheckOptions = {},
): boolean {
  const allowed = PERMISSION_MATRIX[action];
  if (!allowed.includes(userRole)) return false;

  if (action === 'approve_content' && userRole === 'editor') {
    return opts.isOwnResource === true;
  }

  return true;
}
