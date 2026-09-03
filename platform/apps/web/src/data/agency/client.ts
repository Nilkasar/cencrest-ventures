import { apiClient, ApiError } from "@/lib/api-client";
import type { AgencyClientLink, IncomingAgencyLink, InviteAgencyClientInput } from "./types";

/**
 * Epic 18 (Agency / White Label / Integrations)'s data-access seam — same
 * role `data/billing/client.ts` and `data/opportunities/client.ts` play for
 * their epics: every screen calls through here, never `apiClient` directly.
 * Calls `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer:
 *
 *   GET  /api/agency/clients                 -> listAgencyClients()
 *   GET  /api/agency/clients/incoming        -> listIncomingAgencyLinks()
 *   POST /api/agency/clients                 -> inviteAgencyClient()
 *   POST /api/agency/clients/:id/accept      -> acceptAgencyClient()
 *   POST /api/agency/clients/:id/revoke      -> revokeAgencyClient()
 *   POST /api/auth/select-org                -> switchToOrg()
 */

interface AgencyErrorBody {
  error?: string;
  message?: string;
  status?: string;
  metric?: string;
  limit?: number;
  current?: number;
  plan?: string;
  upgradeTo?: string | null;
}

function errorBody(err: unknown): AgencyErrorBody | undefined {
  return err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as AgencyErrorBody) : undefined;
}

/** Thrown when `requirePermission('manage_agency_clients')` rejects a
 *  non-owner/admin caller (`403`). */
export class AgencyForbiddenError extends Error {
  constructor() {
    super("Only an owner or admin can manage client organizations.");
    this.name = "AgencyForbiddenError";
  }
}

/** Thrown when `POST /agency/clients`'s `clientOrgSlug` doesn't resolve to
 *  any organization (`404`). */
export class ClientOrgNotFoundError extends Error {
  constructor(slug: string) {
    super(`No organization found with the slug "${slug}".`);
    this.name = "ClientOrgNotFoundError";
  }
}

/** Thrown on the `422 cannot_link_self` case — an org can't invite itself. */
export class CannotLinkSelfError extends Error {
  constructor() {
    super("An organization can't be its own agency client.");
    this.name = "CannotLinkSelfError";
  }
}

/** Thrown on `409 link_already_exists` — carries the existing link's status
 *  so the dialog can say exactly what's blocking a re-invite. */
export class LinkAlreadyExistsError extends Error {
  constructor(public readonly status: string) {
    super(`A ${status} link to this client already exists.`);
    this.name = "LinkAlreadyExistsError";
  }
}

/** Thrown on `402 client_limit_reached` — the agency tier's `client_accounts`
 *  cap (Epic 16), same typed shape every other capped resource returns. */
export class ClientLimitReachedError extends Error {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: string,
    public readonly upgradeTo: string | null,
  ) {
    super(message);
    this.name = "ClientLimitReachedError";
  }
}

/** Thrown when an `agency_clients` id doesn't resolve for the caller's org
 *  on either side — deleted, never existed, or another org's link. Always a
 *  flat 404, never a 403 that would confirm existence to a non-target org
 *  (`routes/agency.ts`'s own "don't leak enumerable ids" discipline). */
export class AgencyLinkNotFoundError extends Error {
  constructor(message = "That invitation couldn't be found.") {
    super(message);
    this.name = "AgencyLinkNotFoundError";
  }
}

/** Thrown on `409 not_pending` — `/accept` called on a link that isn't
 *  awaiting consent (already accepted, revoked, etc). */
export class LinkNotPendingError extends Error {
  constructor(public readonly status: string) {
    super(`This invitation is ${status}, not pending.`);
    this.name = "LinkNotPendingError";
  }
}

function translateInviteError(err: unknown): never {
  const body = errorBody(err);
  if (err instanceof ApiError) {
    if (err.status === 404) throw new ClientOrgNotFoundError(body?.message ?? "that organization");
    if (err.status === 403) throw new AgencyForbiddenError();
    if (err.status === 422 && body?.error === "cannot_link_self") throw new CannotLinkSelfError();
    if (err.status === 409 && body?.error === "link_already_exists") throw new LinkAlreadyExistsError(body.status ?? "existing");
    if (err.status === 402) {
      throw new ClientLimitReachedError(
        body?.message ?? "Client organization limit reached.",
        body?.limit ?? 0,
        body?.current ?? 0,
        body?.plan ?? "agency",
        body?.upgradeTo ?? null,
      );
    }
  }
  throw err;
}

function translateLinkActionError(err: unknown): never {
  const body = errorBody(err);
  if (err instanceof ApiError) {
    if (err.status === 404) throw new AgencyLinkNotFoundError();
    if (err.status === 403) throw new AgencyForbiddenError();
    if (err.status === 409 && body?.error === "not_pending") throw new LinkNotPendingError(body.message ?? "not pending");
  }
  throw err;
}

/** Agency side: every link regardless of status, real per-client summary
 *  (AVS + open opportunities) for `active` links only. Sorted newest-first
 *  server-side. */
export async function listAgencyClients(): Promise<AgencyClientLink[]> {
  return apiClient.get<AgencyClientLink[]>("/agency/clients");
}

/** Client side: "which agencies are inviting/managing us" — the narrow read
 *  path `agency_clients`' RLS policy doesn't cover on its own (see the
 *  route's header comment); requires org-admin. */
export async function listIncomingAgencyLinks(): Promise<IncomingAgencyLink[]> {
  return apiClient.get<IncomingAgencyLink[]>("/agency/clients/incoming");
}

/** Invites a client org by slug. Never creates an active link — always
 *  `status: "pending"` until the client org's own admin calls
 *  `acceptAgencyClient`. */
export async function inviteAgencyClient(input: InviteAgencyClientInput): Promise<AgencyClientLink> {
  try {
    return await apiClient.post<AgencyClientLink>("/agency/clients", input);
  } catch (err) {
    translateInviteError(err);
  }
}

/** The explicit consent step (client side) — 404 if the link isn't
 *  addressed to the caller's org, 409 if it isn't `pending`. */
export async function acceptAgencyClient(id: string): Promise<{ id: string; status: string; consentedAt: string }> {
  try {
    return await apiClient.post(`/agency/clients/${id}/accept`);
  } catch (err) {
    translateLinkActionError(err);
  }
}

/** Either side may revoke. Idempotent — revoking an already-revoked/
 *  terminated link just reports its status back, no-op server-side. This is
 *  the epic's DoD-critical path: the very next request that relied on this
 *  link is rejected immediately (see `resolveAgencyAccess`'s "no caching,
 *  fresh read every time" doc comment). */
export async function revokeAgencyClient(id: string): Promise<{ id: string; status: string; revokedAt: string | null }> {
  try {
    return await apiClient.post(`/agency/clients/${id}/revoke`);
  } catch (err) {
    translateLinkActionError(err);
  }
}

export interface OrgSelection {
  accessToken: string;
  organization: { id: string; name: string; slug: string; role: string; viaAgencyOrgId?: string };
}

/** Thrown when `/auth/select-org` rejects the caller for `slug` — no direct
 *  membership AND no active `agency_clients` link (or that link was just
 *  revoked). This is the literal "acting as" flow's rejection case the
 *  epic's end-to-end flow step 2/3 describes. */
export class OrgAccessDeniedError extends Error {
  constructor(slug: string) {
    super(`You no longer have access to "${slug}" — the link may have been revoked.`);
    this.name = "OrgAccessDeniedError";
  }
}

/**
 * Mints an org-scoped access token for `slug` — the real "agency user
 * switches to acting as the client" call (`apps/api/src/routes/auth.ts`'s
 * `POST /select-org`, extended this epic to also try `resolveAgencyAccess`
 * before rejecting). The token itself is just a hint: `resolveOrgContext`
 * re-verifies membership AND agency access fresh on every subsequent
 * request, so minting it here grants nothing by itself.
 *
 * KNOWN GAP: nothing in this frontend yet attaches the returned
 * `accessToken` as an `Authorization` header on later `apiClient` calls —
 * that's Epic 0's session/token-storage layer, which (per every other
 * epic's own client — see `lib/api-client.ts`'s doc comment) has not landed
 * in this app yet. `OrgSwitcher` calls this so the real endpoint, request
 * shape, and error cases are exercised end-to-end; wiring the token into
 * subsequent requests is the same follow-up every other epic's real-API
 * wiring is already waiting on, not something this epic can complete
 * alone.
 */
export async function switchToOrg(slug: string): Promise<OrgSelection> {
  try {
    return await apiClient.post<OrgSelection>("/auth/select-org", { slug });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      throw new OrgAccessDeniedError(slug);
    }
    throw err;
  }
}
