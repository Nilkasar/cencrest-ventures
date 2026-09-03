import { apiClient, ApiError } from "@/lib/api-client";
import type {
  ApproveDraftResult,
  ContentBriefDetail,
  ContentBriefsPage,
  ContentDraftDetail,
  GenerateContentBriefResult,
  GenerateDraftResult,
  ListContentBriefsParams,
  QualityChecksResult,
} from "./types";

/**
 * Epic 11 (Content Intelligence & Generation)'s data-access seam — same
 * role `data/recommendations/client.ts` plays for Epic 10. Every screen
 * calls through here, never `apiClient` directly. Calls `platform/apps/api`'s
 * real, tested routes from the first line, no fixture layer:
 *
 *   POST /api/recommendations/:id/content-brief -> generateContentBrief()
 *   GET  /api/brands/me/content-briefs           -> listContentBriefs()
 *   GET  /api/content-briefs/:id                 -> getContentBrief()
 *   POST /api/content-briefs/:id/draft           -> generateDraft()
 *   GET  /api/content-drafts/:id                 -> getContentDraft()
 *   GET  /api/content-drafts/:id/quality-checks  -> getQualityChecks()
 *   POST /api/content-drafts/:id/approve         -> approveDraft()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Thrown when `GET /brands/me/content-briefs` 404s with the shared
 *  `NO_BRAND_ERROR` body — the organization hasn't completed brand
 *  onboarding yet. Same convention `data/recommendations/client.ts`'s own
 *  `NoBrandProfileError` documents. */
export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before viewing content.");
    this.name = "NoBrandProfileError";
  }
}

export class RecommendationNotFoundError extends Error {
  constructor(message = "That recommendation couldn't be found.") {
    super(message);
    this.name = "RecommendationNotFoundError";
  }
}

/** `POST .../content-brief` 409s when the recommendation isn't
 *  `in_progress`/`completed` yet — see `isApprovedRecommendationStatus`,
 *  `apps/api/src/lib/content/brief-builder.ts`. */
export class RecommendationNotApprovedError extends Error {
  constructor(message = "Approve this recommendation (move it to In progress or Completed) before generating a content brief.") {
    super(message);
    this.name = "RecommendationNotApprovedError";
  }
}

/** `POST .../content-brief` 422s when `action_type` isn't `create_page`/
 *  `update_page` — see `isContentTypeRecommendation`. */
export class RecommendationNotContentTypeError extends Error {
  constructor(message = "Only \"Create a page\" or \"Update a page\" recommendations produce a content brief.") {
    super(message);
    this.name = "RecommendationNotContentTypeError";
  }
}

export class ContentBriefNotFoundError extends Error {
  constructor(message = "That content brief couldn't be found.") {
    super(message);
    this.name = "ContentBriefNotFoundError";
  }
}

export class ContentDraftNotFoundError extends Error {
  constructor(message = "That content draft couldn't be found.") {
    super(message);
    this.name = "ContentDraftNotFoundError";
  }
}

/** `GET /brands/me/content-briefs?status=&limit=&offset=`. A 404 (no brand
 *  profile yet) degrades to an empty page rather than an error — same
 *  "let the empty state carry it" precedent `listRecommendations` uses for
 *  the same situation. */
export async function listContentBriefs(params: ListContentBriefsParams = {}): Promise<ContentBriefsPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<ContentBriefsPage>(`/brands/me/content-briefs?${query.toString()}`);
  } catch (err) {
    if (isNotFound(err)) {
      return { briefs: [], pagination: { total: 0, limit: params.limit ?? 25, offset: 0 } };
    }
    throw err;
  }
}

/** Idempotent upsert on `(organization_id, recommendation_id)` — calling
 *  this again for the same recommendation updates the SAME brief row in
 *  place (`created: false`). */
export async function generateContentBrief(recommendationId: string): Promise<GenerateContentBriefResult> {
  try {
    return await apiClient.post<GenerateContentBriefResult>(`/recommendations/${recommendationId}/content-brief`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new RecommendationNotFoundError();
    if (err instanceof ApiError && err.status === 409) throw new RecommendationNotApprovedError();
    if (err instanceof ApiError && err.status === 422) throw new RecommendationNotContentTypeError();
    throw err;
  }
}

/** Brief + every draft version generated under it (version desc). */
export async function getContentBrief(id: string): Promise<ContentBriefDetail> {
  try {
    return await apiClient.get<ContentBriefDetail>(`/content-briefs/${id}`);
  } catch (err) {
    if (isNotFound(err)) throw new ContentBriefNotFoundError();
    throw err;
  }
}

/** Always inserts the NEXT version — never overwrites a prior one. Runs
 *  all 5 quality checks server-side and returns every result alongside the
 *  new draft, never bypassed. */
export async function generateDraft(briefId: string): Promise<GenerateDraftResult> {
  try {
    return await apiClient.post<GenerateDraftResult>(`/content-briefs/${briefId}/draft`);
  } catch (err) {
    if (isNotFound(err)) throw new ContentBriefNotFoundError();
    throw err;
  }
}

/** Draft + its brief inlined — the approval screen's single source for
 *  "draft alongside its brief's original requirements." */
export async function getContentDraft(id: string): Promise<ContentDraftDetail> {
  try {
    return await apiClient.get<ContentDraftDetail>(`/content-drafts/${id}`);
  } catch (err) {
    if (isNotFound(err)) throw new ContentDraftNotFoundError();
    throw err;
  }
}

export async function getQualityChecks(draftId: string): Promise<QualityChecksResult> {
  try {
    return await apiClient.get<QualityChecksResult>(`/content-drafts/${draftId}/quality-checks`);
  } catch (err) {
    if (isNotFound(err)) throw new ContentDraftNotFoundError();
    throw err;
  }
}

/** Idempotent — approving an already-approved draft returns the existing
 *  approval (`alreadyApproved: true`) rather than erroring or duplicating.
 *  A 403 (insufficient role, or an editor approving a draft they didn't
 *  themselves generate) is surfaced as-is — the caller renders
 *  `err.message`/status, same as every other permission-gated action in
 *  this app (no client-side role gate exists yet to pre-empt it). */
export async function approveDraft(draftId: string, notes?: string): Promise<ApproveDraftResult> {
  try {
    return await apiClient.post<ApproveDraftResult>(`/content-drafts/${draftId}/approve`, notes ? { notes } : undefined);
  } catch (err) {
    if (isNotFound(err)) throw new ContentDraftNotFoundError();
    throw err;
  }
}
