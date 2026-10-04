"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "./api-client";
import {
  getAccessTokenOrgId,
  getRefreshToken,
  handleSessionExpired,
  markSessionPresent,
  setOrgScopedAccessToken,
} from "./auth-state";
import type { Organization } from "@/data/types";

export type PlatformRole = "none" | "support" | "admin";
export type OrgKind = "customer" | "agency" | "internal";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** A direct membership, as `GET /api/auth/me` returns it. */
export interface SessionMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
  kind: OrgKind;
  /** Epic 22 Phase 2 — whether the org has a brand row yet. */
  hasBrand?: boolean;
  /** Server-side onboarding completion (`brands.onboarding_completed_at`). */
  onboardingCompletedAt?: string | null;
  /** True only for a `customer` org whose brand onboarding isn't complete. */
  needsOnboarding?: boolean;
}

/** An ACTIVE agency → client link the user reaches through one of their
 *  agency memberships (`GET /api/auth/me`'s `agencyClients`). */
export interface SessionAgencyClient {
  organizationId: string;
  slug: string;
  name: string;
  accessLevel: string;
  status: string;
  agencyOrganizationId: string;
}

export interface SessionOrg {
  id: string;
  slug: string;
  name: string;
  // Reuses `data/types.ts`'s canonical tier union rather than a loose
  // `string`: `competitorLimitFor` and every other entitlement helper is
  // keyed on that union, so a widened type here fails at each call site.
  plan?: Organization["plan"];
  /** Membership role. Undefined when acting as an agency client (the
   *  agency link's role is enforced server-side, not shown here). */
  role?: string;
  /** `customer` for an agency client: `/auth/me` doesn't expose a client
   *  org's kind, and an agency acting for a client gets the client's
   *  Organization view either way. */
  kind: OrgKind;
  /** Set when this org is reached through an agency link, not a membership. */
  viaAgency?: { agencyOrganizationId: string; accessLevel: string };
  /** From the membership (`/auth/me`); undefined for an agency client. */
  needsOnboarding?: boolean;
}

/**
 * The workspaces this user may enter (Epic 22). Derived from `/auth/me`
 * only — a UI hint; each view's API re-checks access on every request.
 */
export type WorkspaceView =
  | { type: "platform"; id: "platform"; href: "/platform" }
  | { type: "agency"; id: `agency:${string}`; href: "/agency"; organization: SessionMembership }
  | {
      type: "org";
      id: `org:${string}`;
      slug: string;
      name: string;
      source: "membership" | "agency-client";
      kind: OrgKind;
      /** For agency clients: which agency membership reaches it. */
      agencyOrganizationId?: string;
    };

interface MeResponse extends SessionUser {
  platformRole: PlatformRole;
  organizations: SessionMembership[];
  agencyClients: SessionAgencyClient[];
}

interface SelectOrgResponse {
  accessToken: string;
  organization: { id: string; name: string; slug: string; role: string };
}

interface ResolvedSession {
  user: SessionUser | null;
  org: SessionOrg | null;
  platformRole: PlatformRole;
  memberships: SessionMembership[];
  agencyClients: SessionAgencyClient[];
}

interface SessionContextValue extends ResolvedSession {
  loading: boolean;
  views: WorkspaceView[];
  /** Bumped after every successful `switchOrg` — key org-scoped subtrees on
   *  it so their data refetches under the new token. */
  orgEpoch: number;
  refresh: () => void;
  /** Re-mints the access token for `slug` via `POST /auth/select-org`
   *  (own org or agency client alike), persists the choice, then reloads
   *  the session. Throws on 403/404/network failure. */
  switchOrg: (slug: string) => Promise<SessionOrg>;
  /** Apply a rename the API already confirmed to the held session at once,
   *  so the switcher/header don't wait on a `/auth/me` round trip. Callers
   *  still `refresh()` afterwards to reconcile with the server. */
  applyOrgRename: (orgId: string, name: string) => void;
}

const SIGNED_OUT: ResolvedSession = {
  user: null,
  org: null,
  platformRole: "none",
  memberships: [],
  agencyClients: [],
};

const SessionContext = createContext<SessionContextValue>({
  ...SIGNED_OUT,
  loading: true,
  views: [],
  orgEpoch: 0,
  refresh: () => undefined,
  switchOrg: () => Promise.reject(new Error("SessionProvider is not mounted")),
  applyOrgRename: () => undefined,
});

function toSessionOrg(me: MeResponse, orgId: string): SessionOrg | null {
  const membership = me.organizations.find((m) => m.id === orgId);
  if (membership) {
    return {
      id: membership.id,
      slug: membership.slug,
      name: membership.name,
      role: membership.role,
      kind: membership.kind,
      needsOnboarding: membership.needsOnboarding,
    };
  }
  const client = me.agencyClients.find((c) => c.organizationId === orgId);
  if (client) {
    return {
      id: client.organizationId,
      slug: client.slug,
      name: client.name,
      kind: "customer",
      viaAgency: { agencyOrganizationId: client.agencyOrganizationId, accessLevel: client.accessLevel },
    };
  }
  return null;
}

export function deriveViews(
  platformRole: PlatformRole,
  memberships: SessionMembership[],
  agencyClients: SessionAgencyClient[],
): WorkspaceView[] {
  const views: WorkspaceView[] = [];
  if (platformRole !== "none") views.push({ type: "platform", id: "platform", href: "/platform" });
  for (const m of memberships) {
    if (m.kind === "agency") views.push({ type: "agency", id: `agency:${m.slug}`, href: "/agency", organization: m });
  }
  for (const m of memberships) {
    views.push({ type: "org", id: `org:${m.slug}`, slug: m.slug, name: m.name, source: "membership", kind: m.kind });
  }
  const memberSlugs = new Set(memberships.map((m) => m.slug));
  for (const c of agencyClients) {
    if (memberSlugs.has(c.slug)) continue; // a direct membership already covers it
    views.push({
      type: "org",
      id: `org:${c.slug}`,
      slug: c.slug,
      name: c.name,
      source: "agency-client",
      kind: "customer",
      agencyOrganizationId: c.agencyOrganizationId,
    });
  }
  return views;
}

/**
 * One round trip that settles who the user is and which org they act as.
 * `/auth/me` is the single source: memberships (with `kind`), agency
 * clients and platform role. On a fresh load there is no access token yet,
 * so it 401s once and `api-client` refreshes with the persisted org slug —
 * after which the token's `org` claim says which org the API will actually
 * act as. If nothing is selected (or the selection is no longer reachable)
 * it falls back to the first membership AND mints a token for it, so the
 * org shown is always the org every request is scoped to.
 */
async function loadSession(): Promise<ResolvedSession> {
  const me = await apiClient.get<MeResponse>("/auth/me");
  const tokenOrgId = getAccessTokenOrgId();
  let org = tokenOrgId ? toSessionOrg(me, tokenOrgId) : null;
  if (!org && me.organizations[0]) {
    const selection = await selectOrg(me.organizations[0].slug);
    org = toSessionOrg(me, selection.organization.id);
  }
  return {
    user: { id: me.id, email: me.email, name: me.name },
    org,
    platformRole: me.platformRole ?? "none",
    memberships: me.organizations ?? [],
    agencyClients: me.agencyClients ?? [],
  };
}

async function selectOrg(slug: string): Promise<SelectOrgResponse> {
  const selection = await apiClient.post<SelectOrgResponse>("/auth/select-org", { slug });
  setOrgScopedAccessToken(selection.accessToken, selection.organization.slug);
  return selection;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // `loading` is DERIVED, never set: `resolved.tick` records which fetch
  // generation the held session came from, so a `refresh()` bump makes the
  // context read as loading on the very same render, with no setState in the
  // effect body (react-hooks/set-state-in-effect) and no cascading render.
  // The previous session stays readable while a refresh is in flight.
  const [resolved, setResolved] = useState<ResolvedSession & { tick: number | null }>({ ...SIGNED_OUT, tick: null });
  const [tick, setTick] = useState(0);
  const [orgEpoch, setOrgEpoch] = useState(0);
  const loading = resolved.tick !== tick;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // No refresh token: never signed in here, or signed out in this
      // browser. If the proxy let us in anyway, its presence cookie is stale
      // — clear it and go to /login (with `next`) instead of rendering an
      // empty shell.
      if (!getRefreshToken()) {
        if (!cancelled) {
          setResolved({ ...SIGNED_OUT, tick });
          handleSessionExpired();
        }
        return;
      }
      markSessionPresent();
      try {
        const next = await loadSession();
        if (!cancelled) setResolved({ ...next, tick });
      } catch {
        if (!cancelled) setResolved({ ...SIGNED_OUT, tick });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const switchOrg = useCallback(
    async (slug: string): Promise<SessionOrg> => {
      await selectOrg(slug);
      // Settle the new session BEFORE anything re-renders against it, then
      // swap session + remount key in one go — no window where a page sees
      // the new token with the old org (or vice versa).
      const next = await loadSession();
      if (!next.org || next.org.slug !== slug) {
        throw new Error(`Switched to ${slug}, but the session resolved to ${next.org?.slug ?? "no organization"}`);
      }
      setResolved((prev) => ({ ...next, tick: prev.tick }));
      setOrgEpoch((e) => e + 1);
      return next.org;
    },
    [],
  );

  const applyOrgRename = useCallback((orgId: string, name: string) => {
    setResolved((prev) => ({
      ...prev,
      org: prev.org?.id === orgId ? { ...prev.org, name } : prev.org,
      memberships: prev.memberships.map((m) => (m.id === orgId ? { ...m, name } : m)),
      agencyClients: prev.agencyClients.map((c) => (c.organizationId === orgId ? { ...c, name } : c)),
    }));
  }, []);

  const views = useMemo(
    () => deriveViews(resolved.platformRole, resolved.memberships, resolved.agencyClients),
    [resolved.platformRole, resolved.memberships, resolved.agencyClients],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user: resolved.user,
      org: resolved.org,
      platformRole: resolved.platformRole,
      memberships: resolved.memberships,
      agencyClients: resolved.agencyClients,
      loading,
      views,
      orgEpoch,
      refresh,
      switchOrg,
      applyOrgRename,
    }),
    [resolved, loading, views, orgEpoch, refresh, switchOrg, applyOrgRename],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function useCurrentUser(): SessionUser | null {
  return useContext(SessionContext).user;
}

export function useCurrentOrg(): SessionOrg | null {
  return useContext(SessionContext).org;
}
