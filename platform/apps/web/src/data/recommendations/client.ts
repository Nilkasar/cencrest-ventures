import { apiClient, ApiError } from "@/lib/api-client";
import type { GenerateRecommendationResult, ListRecommendationsParams, Recommendation, RecommendationsPage, RecommendationStatus } from "./types";

/**
 * Epic 10 (Recommendation Engine)'s data-access seam — same role
 * `data/opportunities/client.ts` plays for Epic 9. Every screen calls
 * through here, never `apiClient` directly. Calls `platform/apps/api`'s
 * real, tested routes from the first line, no fixture layer:
 *
 *   POST  /api/opportunities/:id/recommendations/generate -> generateRecommendation()
 *   GET   /api/brands/me/recommendations                  -> listRecommendations()
 *   PATCH /api/recommendations/:id                         -> updateRecommendationStatus()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Thrown when any route 404s with the shared `NO_BRAND_ERROR` body — the
 *  organization hasn't completed brand onboarding yet. Same convention
 *  `data/opportunities/client.ts`'s own `NoBrandProfileError` documents. */
export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before viewing recommendations.");
    this.name = "NoBrandProfileError";
  }
}

/** Thrown when `POST .../recommendations/generate` 404s — the opportunity
 *  id doesn't resolve for this org (deleted, never existed, or another
 *  org's row). Never a 403 that would confirm existence (tenant isolation),
 *  per `opportunity-recommendations.ts`'s own `NOT_FOUND_ERROR` convention. */
export class OpportunityNotFoundError extends Error {
  constructor(message = "That opportunity couldn't be found.") {
    super(message);
    this.name = "OpportunityNotFoundError";
  }
}

/** Thrown when a recommendation id doesn't resolve for this org — deleted,
 *  never existed, or another org's row. */
export class RecommendationNotFoundError extends Error {
  constructor(message = "That recommendation couldn't be found.") {
    super(message);
    this.name = "RecommendationNotFoundError";
  }
}

/** Sorted server-side by `priorityRank` desc (tiebreak `createdAt` asc, then
 *  `id` asc — `routes/recommendations.ts`'s `GET /` handler) — never
 *  re-sorted client-side. A 404 (no brand profile yet) degrades to an empty
 *  page rather than an error, same "let the empty state carry it" precedent
 *  `listOpportunities` uses for the same situation. */
export async function listRecommendations(params: ListRecommendationsParams = {}): Promise<RecommendationsPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.actionType) query.set("actionType", params.actionType);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<RecommendationsPage>(`/brands/me/recommendations?${query.toString()}`);
  } catch (err) {
    if (isNotFound(err)) {
      return { recommendations: [], pagination: { total: 0, limit: params.limit ?? 25, offset: 0 } };
    }
    throw err;
  }
}

/** Idempotent — calling this again for the same opportunity updates the
 *  SAME recommendation row in place (`created: false`) rather than
 *  duplicating it, so `opportunity-card.tsx`'s "Generate recommendation"
 *  action is always safe to press again once evidence changes (e.g. after
 *  a Recompute). */
export async function generateRecommendation(opportunityId: string): Promise<GenerateRecommendationResult> {
  try {
    return await apiClient.post<GenerateRecommendationResult>(`/opportunities/${opportunityId}/recommendations/generate`);
  } catch (err) {
    if (isNotFound(err)) throw new OpportunityNotFoundError();
    throw err;
  }
}

/** Status transitions — audit-logged server-side
 *  (`action: 'recommendation.status_changed'`). */
export async function updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation> {
  try {
    return await apiClient.patch<Recommendation>(`/recommendations/${id}`, { status });
  } catch (err) {
    if (isNotFound(err)) throw new RecommendationNotFoundError();
    throw err;
  }
}
