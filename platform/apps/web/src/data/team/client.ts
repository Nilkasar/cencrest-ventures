import { apiClient, ApiError } from "@/lib/api-client";
import type { AssignableRole, InviteTeamMemberInput, TeamMember } from "./types";

/**
 * Settings > Team's data-access seam. Wires directly into the real Epic 0
 * routes (`apps/api/src/routes/orgs.ts`) — replaces the "invites are
 * stubbed until Epic 0's auth backend ships" fixture note a route-wiring
 * audit flagged, even though that backend has been real, tested, and
 * VERIFIED since Wave 1 of this build:
 *
 *   GET    /api/orgs/:slug/members         -> loadTeamData() (via listMembers)
 *   POST   /api/orgs/:slug/invitations     -> inviteMember()
 *   PATCH  /api/orgs/:slug/members/:userId -> changeMemberRole()
 *   DELETE /api/orgs/:slug/members/:userId -> removeMember()
 *
 * Every one of those is `:slug`-addressed (`requireOrgBySlug` — the org
 * comes from the URL, re-verified against real membership server-side on
 * every call), unlike every other already-wired epic in this app, which
 * reads its org from the access token's `org` claim instead
 * (`requireOrgFromToken` — see `data/billing/client.ts`'s `/orgs/me/...`
 * routes for the contrast). This app has no wired "what's my home
 * organization's slug" session/context provider yet:
 * `platform/docs/epics/00-session-token-wiring-fix.md`'s "What's still not
 * real" section flags exactly this gap and names building a `/me`-backed
 * context provider a reasonable follow-up, not something that pass
 * silently skipped. `resolveOrgSlug` below is the interim, scoped-to-this-
 * screen answer: it calls the real `GET /auth/me` (which already returns
 * every real membership with its slug) and takes the first one. For the
 * overwhelmingly common single-membership user that's exactly the org this
 * screen should act on; a user who is a direct member of more than one
 * organization will always resolve to the first one `/auth/me` returns
 * until that provider exists — see this file's own epic write-up
 * (`docs/epics/00-team-settings-rewire.md`) for the honest gap note.
 *
 * Deliberately NOT cached at module scope: `lib/auth-state.ts`'s access
 * token resets on every reload and this file has no hook into
 * `clearSession`'s logout path, so caching here risks leaking one user's
 * resolved org slug into a different user's session within the same tab.
 * One extra `/auth/me` round trip per panel load/reload is the safer
 * trade.
 */

interface MeResponse {
  id: string;
  email: string;
  name: string;
  organizations: { id: string; name: string; slug: string; role: string }[];
}

/** Thrown when the caller's `/auth/me` reports no memberships at all —
 *  shouldn't be reachable from a normal signed-up account, but this screen
 *  fails honestly rather than crashing if it ever is. */
export class NoOrganizationError extends Error {
  constructor() {
    super("Your account isn't a member of any organization yet.");
    this.name = "NoOrganizationError";
  }
}

async function resolveOrgSlug(): Promise<string> {
  const me = await apiClient.get<MeResponse>("/auth/me");
  const first = me.organizations[0];
  if (!first) throw new NoOrganizationError();
  return first.slug;
}

/** Thrown on a `403` from any mutating call below that isn't the more
 *  specific owner-protection case — `manage_team` is owner/admin-only
 *  (`apps/api/src/lib/rbac.ts`'s `PERMISSION_MATRIX`). */
export class TeamForbiddenError extends Error {
  constructor(message = "Only an organization owner or admin can manage the team.") {
    super(message);
    this.name = "TeamForbiddenError";
  }
}

/** Thrown on the owner-protection `403`s — `routes/orgs.ts`'s literal
 *  "Cannot change owner role" / "Cannot remove owner" responses. Distinct
 *  from `TeamForbiddenError` (a permission gap) so the UI can explain the
 *  real reason instead of a generic "not allowed." */
export class OwnerProtectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerProtectedError";
  }
}

/** Thrown on `404` — the target membership no longer exists (already
 *  removed by someone else, most likely). */
export class MemberNotFoundError extends Error {
  constructor() {
    super("That member is no longer part of this organization.");
    this.name = "MemberNotFoundError";
  }
}

interface OrgErrorBody {
  error?: string;
}

function translateError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as OrgErrorBody | undefined;
    if (err.status === 403 && (body?.error === "Cannot change owner role" || body?.error === "Cannot remove owner")) {
      throw new OwnerProtectedError(body.error);
    }
    if (err.status === 403) throw new TeamForbiddenError();
    if (err.status === 404) throw new MemberNotFoundError();
  }
  throw err;
}

export interface TeamData {
  /** The org slug every mutation below must be addressed to — resolved
   *  once per load so a role-change/remove/invite always targets the same
   *  org the list came from. */
  slug: string;
  members: TeamMember[];
}

/** Loads this org's real member list. Resolves the slug first (see header
 *  comment) — the panel calls this rather than composing `resolveOrgSlug`
 *  and a raw list call itself. */
export async function loadTeamData(): Promise<TeamData> {
  const slug = await resolveOrgSlug();
  const members = await apiClient.get<TeamMember[]>(`/orgs/${slug}/members`);
  return { slug, members };
}

/** `routes/orgs.ts` returns `{ success, expiresAt }` on `201` — the invite
 *  link is always valid for `INVITATION_TTL_MS` (7 days). */
export async function inviteMember(slug: string, input: InviteTeamMemberInput): Promise<{ expiresAt: string }> {
  try {
    return await apiClient.post<{ success: boolean; expiresAt: string }>(`/orgs/${slug}/invitations`, input);
  } catch (err) {
    translateError(err);
  }
}

export async function changeMemberRole(slug: string, userId: string, role: AssignableRole): Promise<void> {
  try {
    await apiClient.patch(`/orgs/${slug}/members/${userId}`, { role });
  } catch (err) {
    translateError(err);
  }
}

export async function removeMember(slug: string, userId: string): Promise<void> {
  try {
    await apiClient.delete(`/orgs/${slug}/members/${userId}`);
  } catch (err) {
    translateError(err);
  }
}
