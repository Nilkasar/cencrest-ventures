import { apiClient, ApiError } from "@/lib/api-client";
import type {
  ListOpportunitiesParams,
  OpportunitiesPage,
  OpportunityDetail,
  OpportunityPatchInput,
  RecomputeResult,
} from "./types";

/**
 * Epic 9 (Opportunity Engine)'s data-access seam — same role
 * `data/competitive-intelligence/client.ts` and `data/seo/client.ts` play for
 * their epics: every screen calls through here, never `apiClient` directly.
 * Calls `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer:
 *
 *   POST /api/brands/me/opportunities/recompute -> recomputeOpportunities()
 *   GET  /api/brands/me/opportunities            -> listOpportunities()
 *   GET  /api/opportunities/:id                  -> getOpportunity()
 *   PATCH /api/opportunities/:id                 -> updateOpportunity()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
    const value = (err.body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
    const value = (err.body as { message?: unknown }).message;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** Thrown when `POST .../recompute` 404s because the brand has no active
 *  query set yet (`NO_ACTIVE_QUERY_SET_ERROR` in `routes/opportunities.ts`)
 *  — the merge has nothing to iterate. Distinct from a real failure; the
 *  screen shows this as a directed nudge toward Query Universe, same
 *  convention `AiRunPreconditionError` uses for the identical precondition
 *  on AI Visibility/Competitor runs. */
export class NoActiveQuerySetError extends Error {
  constructor(message = "This brand has no active query set. Activate one in Query Universe first.") {
    super(message);
    this.name = "NoActiveQuerySetError";
  }
}

/** Thrown when any route 404s with the shared `NO_BRAND_ERROR` body — the
 *  organization hasn't completed brand onboarding yet. */
export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before generating opportunities.");
    this.name = "NoBrandProfileError";
  }
}

/** Thrown when an opportunity id doesn't resolve for this org — deleted,
 *  never existed, or another org's row. Never a 403 that would confirm
 *  existence (tenant isolation), per `opportunity-details.ts`'s own
 *  `NOT_FOUND_ERROR` convention (a flat 404 regardless of which case). */
export class OpportunityNotFoundError extends Error {
  constructor(message = "That opportunity couldn't be found.") {
    super(message);
    this.name = "OpportunityNotFoundError";
  }
}

/** Sorted server-side by `opportunityScore` desc (tiebreak `createdAt` asc,
 *  then `id` asc — see `routes/opportunities.ts`'s `GET /` handler) — never
 *  re-sorted client-side. A 404 (no brand profile yet) degrades to an empty
 *  page rather than an error, same "let the empty state carry it" precedent
 *  `listKeywordGroups`/`fetchQueryUniverse` use for the same situation. */
export async function listOpportunities(params: ListOpportunitiesParams = {}): Promise<OpportunitiesPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.type) query.set("type", params.type);
  if (params.priority) query.set("priority", String(params.priority));
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<OpportunitiesPage>(`/brands/me/opportunities?${query.toString()}`);
  } catch (err) {
    if (isNotFound(err)) {
      return { opportunities: [], pagination: { total: 0, limit: params.limit ?? 50, offset: 0 } };
    }
    throw err;
  }
}

/** Runs the SEO+GEO merge (`docs/epics/09-opportunity-engine.md`'s "merge
 *  logic") for every intent in the brand's active query set. Idempotent —
 *  safe to call repeatedly; existing open opportunities are updated in
 *  place, not duplicated, and a dismissed one is left alone unless its
 *  underlying signal materially changed (see the backend completion doc's
 *  "Idempotency" section for the exact rules this UI relies on when showing
 *  the run summary). */
export async function recomputeOpportunities(): Promise<RecomputeResult> {
  try {
    return await apiClient.post<RecomputeResult>("/brands/me/opportunities/recompute");
  } catch (err) {
    if (isNotFound(err) && errorCode(err) === "no_active_query_set") {
      throw new NoActiveQuerySetError(errorMessage(err));
    }
    if (isNotFound(err)) throw new NoBrandProfileError();
    throw err;
  }
}

/** Full detail with the evidence trail inlined — this is the "one click
 *  away" fetch `opportunity-card.tsx` makes the first time a card's evidence
 *  disclosure opens, per the epic's "never buried" UI requirement. */
export async function getOpportunity(id: string): Promise<OpportunityDetail> {
  try {
    return await apiClient.get<OpportunityDetail>(`/opportunities/${id}`);
  } catch (err) {
    if (isNotFound(err)) throw new OpportunityNotFoundError();
    throw err;
  }
}

/** Status/priority transitions — audit-logged server-side
 *  (`action: 'opportunity.status_changed'`) regardless of which field(s)
 *  changed. Callers must include `dismissalReason` when setting
 *  `status: "dismissed"` (enforced both here via the type and server-side
 *  via a 422); `opportunity-card.tsx` never calls this without a
 *  non-empty reason for that transition. */
export async function updateOpportunity(id: string, patch: OpportunityPatchInput): Promise<OpportunityDetail> {
  try {
    return await apiClient.patch<OpportunityDetail>(`/opportunities/${id}`, patch);
  } catch (err) {
    if (isNotFound(err)) throw new OpportunityNotFoundError();
    throw err;
  }
}
