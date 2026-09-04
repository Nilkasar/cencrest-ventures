/**
 * Settings > Team — Epic 0's org/membership management. Types mirror
 * `apps/api/src/routes/orgs.ts`'s member/invitation routes exactly (field
 * names/order checked against the route handlers and `routes/orgs.test.ts`,
 * not assumed).
 */

/** The full role enum a membership row can carry — `packages/database`'s
 *  `role` enum minus `system`/`super_admin`, which are never assigned via a
 *  membership row (see `apps/api/src/lib/rbac.ts`'s header comment).
 *  `member` is a deprecated alias for `analyst`, kept only because an
 *  existing row could still carry it. */
export type MembershipRole = "owner" | "admin" | "analyst" | "editor" | "viewer" | "member";

/** Roles `PATCH /orgs/:slug/members/:userId` and `POST
 *  /orgs/:slug/invitations` actually accept — `changeRoleSchema`/
 *  `inviteSchema`'s `z.enum([...])` in `routes/orgs.ts`. Deliberately
 *  excludes `owner` (ownership isn't transferred this way — the backend
 *  403s "Cannot change owner role") and the deprecated `member` alias (new
 *  code shouldn't assign it). */
export const ASSIGNABLE_ROLES = ["admin", "analyst", "editor", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  analyst: "Analyst",
  editor: "Editor",
  viewer: "Viewer",
  member: "Member",
};

export function isAssignableRole(role: MembershipRole): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** `GET /orgs/:slug/members` — one row per membership. */
export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  joinedAt: string;
}

export interface InviteTeamMemberInput {
  email: string;
  role: AssignableRole;
}
