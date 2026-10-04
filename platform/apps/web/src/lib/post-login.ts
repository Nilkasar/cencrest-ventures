/**
 * What happens right after a successful sign-in (magic link or Google) —
 * shared by both callback pages so they can't drift apart.
 *
 * A freshly issued access token carries NO org claim, so one is selected
 * here (and persisted for later refreshes). A brand-new user gets a default
 * organization first; its slug is resolved SERVER-side (`john` → `john-2`
 * on a collision, `POST /api/orgs` without `slug`/`strictSlug`), so the
 * second "john@…" to sign up is never stranded without a workspace.
 *
 * Returns where to send the user:
 *   - an invitation link they signed in to accept always wins — and a new
 *     user arriving that way gets NO default org (they're joining one);
 *   - else the active org's `needsOnboarding` → `/onboarding`;
 *   - else the parked `?next=` path, or `/overview`.
 */
import { apiClient } from "./api-client";
import { consumePostLoginPath, setOrgScopedAccessToken } from "./auth-state";

interface MeOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  needsOnboarding?: boolean;
}

interface MeResponse {
  id: string;
  email: string;
  name: string;
  organizations: MeOrganization[];
}

interface SelectOrgResponse {
  accessToken: string;
  organization: { id: string; name: string; slug: string; role: string };
}

interface CreateOrgResponse {
  id: string;
  name: string;
  slug: string;
}

/** Mirrors the API's `toSlug` alphabet — how many slug characters a name yields. */
function slugLength(value: string): number {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "")
    .length;
}

/**
 * A default organization name that always slugifies to ≥ 2 characters
 * (`POST /api/orgs` answers 422 otherwise, which used to leave a new user
 * with no workspace at all):
 *   profile name ("Jane Doe")            → "Jane Doe"
 *   email prefix ("john@…")              → "john"
 *   1-char prefix ("j@acme.com")         → "j's workspace"
 *   no usable prefix ("+@acme.com")      → "acme" (the domain), else "My workspace"
 */
export function defaultOrganizationName(name: string | null | undefined, email: string): string {
  const trimmedName = (name ?? "").trim();
  if (trimmedName.length >= 2 && slugLength(trimmedName) >= 2) return trimmedName.slice(0, 100);

  const [prefix = "", domain = ""] = email.split("@");
  if (slugLength(prefix) >= 2) return prefix.slice(0, 100);
  if (slugLength(prefix) === 1) return `${prefix.slice(0, 60)}'s workspace`;

  const domainLabel = domain.split(".")[0] ?? "";
  if (slugLength(domainLabel) >= 2) return domainLabel.slice(0, 100);
  return "My workspace";
}

function isInvitationPath(path: string | null): path is string {
  return !!path && (path === "/invitations" || path.startsWith("/invitations/"));
}

export async function completeSignIn(): Promise<string> {
  const next = consumePostLoginPath();
  try {
    const me = await apiClient.get<MeResponse>("/auth/me");
    let active: MeOrganization | undefined = me.organizations[0];

    if (!active) {
      if (isInvitationPath(next)) return next;
      const created = await apiClient.post<CreateOrgResponse>("/orgs", { name: defaultOrganizationName(me.name, me.email) });
      // A brand-new customer org has no brand yet, so it needs onboarding.
      active = { id: created.id, name: created.name, slug: created.slug, role: "owner", needsOnboarding: true };
    }

    const selection = await apiClient.post<SelectOrgResponse>("/auth/select-org", { slug: active.slug });
    setOrgScopedAccessToken(selection.accessToken, selection.organization.slug);

    if (isInvitationPath(next)) return next;
    if (active.needsOnboarding) return "/onboarding";
    return next ?? "/overview";
  } catch {
    // Signed in either way; the app shell re-resolves the org on load.
    return next ?? "/overview";
  }
}
