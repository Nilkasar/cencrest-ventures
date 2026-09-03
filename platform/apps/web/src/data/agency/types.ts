/**
 * Epic 18 (Agency / White Label / Integrations) — `agency_clients` wire
 * shapes. Mirrors `apps/api/src/routes/agency.ts`'s `serializeLink` and its
 * two list endpoints exactly (read before writing this file, not guessed
 * from the epic spec's prose) — every field is already camelCase, so there
 * is no `Api*` + `map*` translation layer here, same "comes across as-is"
 * situation `data/opportunities/types.ts`'s header describes for Epic 9.
 *
 * See `platform/docs/epics/18-agency-white-label-integrations-backend.md`
 * for the exact response examples this was checked against.
 */

/** `agency_clients.status` — widened in this epic's migration
 *  (`0013_agency_white_label_integrations/checks.sql`) to add `pending`
 *  (the default — an invite that hasn't been consented yet) and `revoked`
 *  (explicit access pull, distinct from `terminated`'s "contract ended"
 *  business meaning) alongside the pre-existing `active`/`paused`/
 *  `terminated`. */
export type AgencyLinkStatus = "pending" | "active" | "paused" | "terminated" | "revoked";

/** `agency_clients.access_level`, mapped onto this platform's real `role`
 *  enum by `apps/api/src/lib/agency-access.ts`'s `accessLevelToRole`
 *  (`full -> admin`, `limited -> analyst`, `read_only -> viewer`). Only
 *  these three are grantable via `POST /agency/clients` (`GRANTABLE_ROLES`). */
export type AgencyClientRole = "admin" | "analyst" | "viewer";

export interface AgencyClientSummary {
  hasBrand: boolean;
  aiVisibilityScore: number | null;
  aiVisibilityScoreAsOf: string | null;
  openOpportunities: number | null;
}

/** One row of `GET /agency/clients` (agency side) — every link regardless
 *  of status, `summary` populated only for `active` links (`null`
 *  otherwise; no cross-org read is even attempted for a non-active link,
 *  per this table's RLS/application-code split — see the route's own
 *  header comment). */
export interface AgencyClientLink {
  id: string;
  agencyOrgId: string;
  clientOrgId: string;
  clientOrgName: string | null;
  clientOrgSlug: string | null;
  role: AgencyClientRole;
  status: AgencyLinkStatus;
  invitedAt: string;
  consentedAt: string | null;
  revokedAt: string | null;
  summary: AgencyClientSummary | null;
}

/** One row of `GET /agency/clients/incoming` (client side) — "which
 *  agencies are inviting/managing us." No `summary` — the client side never
 *  reads anything about itself through this path, it already has its own
 *  data. */
export interface IncomingAgencyLink {
  id: string;
  agencyOrgId: string;
  agencyOrgName: string | null;
  agencyOrgSlug: string | null;
  role: AgencyClientRole;
  status: AgencyLinkStatus;
  invitedAt: string;
}

export interface InviteAgencyClientInput {
  clientOrgSlug: string;
  role: AgencyClientRole;
}
