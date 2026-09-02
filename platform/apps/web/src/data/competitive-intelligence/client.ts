import { apiClient, ApiError } from "@/lib/api-client";
import { AiRunPreconditionError } from "@/data/ai-visibility/client";
import type { AiRun } from "@/data/ai-visibility/types";
import type { CompetitiveGapsResponse, MovementResult, ShareOfVoiceResponse } from "./types";

/**
 * Epic 8 — Competitive Intelligence's data-access seam. Same role as
 * `data/ai-visibility/client.ts` — every screen calls through here, never
 * `apiClient` directly. Calls `platform/apps/api`'s real, tested routes
 * from the first line, no fixture layer:
 *
 *   GET  /api/brands/me/competitors/:id/ai-runs -> listCompetitorAiRuns()
 *   POST /api/brands/me/competitors/:id/ai-runs -> startCompetitorAiRun()
 *   GET  /api/brands/me/competitive-gaps        -> getCompetitiveGaps()
 *   GET  /api/brands/me/share-of-voice          -> getShareOfVoice()
 *   GET  /api/brands/me/competitors/:id/movement -> getCompetitorMovement()
 *
 * A competitor run is a plain `ai_runs` row with `competitorId` set (Epic
 * 7's identical pipeline, just pointed at a competitor) — polling one and
 * viewing its full drill-down detail reuses `data/ai-visibility/client.ts`'s
 * `getAiRun`/`getAiRunScore`/`getAiRunResponses`/`getQuerySetQueries`
 * directly (those routes are scoped by organization only, not by whether
 * `competitor_id` is set), which is why this file only adds the four
 * competitor-specific endpoints above rather than re-implementing any of
 * Epic 7's run-detail plumbing.
 */

/** Thrown when starting a competitor run is rejected by the
 *  `competitors_tracked` entitlement (402 `competitor_tracking_limit_reached`)
 *  — this epic's distinct "how many competitors have ACTIVE AI-run
 *  tracking" counter, checked only the first time a given competitor is
 *  run (re-measuring an already-tracked competitor never hits this). */
export class CompetitorTrackingLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    public readonly plan: string,
    public readonly upgradeTo: string | null,
  ) {
    super(
      `Your ${plan} plan tracks AI-run visibility for up to ${limit} competitors (you have ${current} actively tracked).${
        upgradeTo ? ` Upgrade to ${upgradeTo} to track more.` : ""
      }`,
    );
    this.name = "CompetitorTrackingLimitError";
  }
}

/** Mirrors `AiQueryLimitError` in `data/ai-visibility/client.ts` — kept as
 *  a separate class (rather than importing that one) because the message
 *  here reflects the exact wording the competitor route sends, and because
 *  callers need to tell the two 402s apart independently of which run
 *  kind triggered them. */
export class AiQueryLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    public readonly requested: number,
    public readonly plan: string,
    public readonly upgradeTo: string | null,
  ) {
    super(
      `Your ${plan} plan allows up to ${limit.toLocaleString()} AI queries per month (this run would use ${requested.toLocaleString()}, and you've already used ${current.toLocaleString()} this month).${
        upgradeTo ? ` Upgrade to ${upgradeTo} for a higher limit.` : ""
      }`,
    );
    this.name = "AiQueryLimitError";
  }
}

/** Thrown when the competitor id itself doesn't resolve for this brand —
 *  another org's competitor, a deleted one, or a stale id. Never a 403
 *  that would confirm existence (tenant isolation), per the backend's own
 *  `COMPETITOR_NOT_FOUND_ERROR` convention. */
export class CompetitorNotFoundError extends Error {
  constructor(message = "That competitor couldn't be found.") {
    super(message);
    this.name = "CompetitorNotFoundError";
  }
}

interface StartCompetitorRunErrorBody {
  error?: string;
  message?: string;
  limit?: number;
  current?: number;
  requested?: number;
  plan?: string;
  upgradeTo?: string | null;
}

function translateStartError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as StartCompetitorRunErrorBody | undefined;
    if (err.status === 402 && body?.error === "competitor_tracking_limit_reached") {
      throw new CompetitorTrackingLimitError(body.limit ?? 0, body.current ?? 0, body.plan ?? "free", body.upgradeTo ?? null);
    }
    if (err.status === 402 && body?.error === "ai_query_limit_reached") {
      throw new AiQueryLimitError(body.limit ?? 0, body.current ?? 0, body.requested ?? 0, body.plan ?? "free", body.upgradeTo ?? null);
    }
    if (err.status === 404 && body?.error === "no_active_query_set") {
      throw new AiRunPreconditionError("no_active_query_set", body.message ?? "This brand has no active query set.");
    }
    if (err.status === 422 && body?.error === "query_set_empty") {
      throw new AiRunPreconditionError("query_set_empty", body.message ?? "The active query set has no queries.");
    }
    if (err.status === 404 && body?.error === "Competitor not found") {
      throw new CompetitorNotFoundError();
    }
    if (err.status === 404) {
      throw new AiRunPreconditionError("no_brand", "Complete brand onboarding before running AI Visibility.");
    }
  }
  throw err;
}

/** Newest first, scoped to exactly this competitor. A 404 (no brand yet, or
 *  the competitor doesn't resolve for this brand) degrades to an empty
 *  list — same "let the empty state carry it" convention `listAiRuns`
 *  uses — since a competitor with zero runs is a completely normal state
 *  here (it just hasn't been checked yet), not an error. */
export async function listCompetitorAiRuns(competitorId: string): Promise<AiRun[]> {
  try {
    return await apiClient.get<AiRun[]>(`/brands/me/competitors/${competitorId}/ai-runs`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export async function getLatestCompetitorAiRun(competitorId: string): Promise<AiRun | null> {
  const runs = await listCompetitorAiRuns(competitorId);
  return runs[0] ?? null;
}

/** Kicks off Epic 7's identical pipeline against this competitor on the
 *  brand's active query set. Body-less POST, same as `startAiRun`.
 *  Rethrows the entitlement/precondition/not-found failures above as typed
 *  errors; anything else propagates as a plain `ApiError`. */
export async function startCompetitorAiRun(competitorId: string): Promise<AiRun> {
  try {
    return await apiClient.post<AiRun>(`/brands/me/competitors/${competitorId}/ai-runs`);
  } catch (err) {
    translateStartError(err);
  }
}

/** Always 200 (`computed: false` before the brand has a completed run on
 *  the active query set) — poll/refetch this like run status, never guess
 *  whether the shape means "error" or "not ready yet." A 404 (no active
 *  query set at all) degrades to `null` so the calling panel can render
 *  its own "activate a query set first" empty state consistent with the
 *  rest of the app rather than a generic error. */
export async function getCompetitiveGaps(): Promise<CompetitiveGapsResponse | null> {
  try {
    return await apiClient.get<CompetitiveGapsResponse>("/brands/me/competitive-gaps");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Same shape/convention as `getCompetitiveGaps` — a missing query set
 *  degrades to `null`, not an error. */
export async function getShareOfVoice(): Promise<ShareOfVoiceResponse | null> {
  try {
    return await apiClient.get<ShareOfVoiceResponse>("/brands/me/share-of-voice");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** On-demand movement check for one competitor — compares its two most
 *  recent COMPLETED runs (not required to share a query_set). This is the
 *  "build the comparison logic now" half of the spec's movement-alerts
 *  note; nothing calls this periodically yet (Epic 12's Competitor Agent
 *  owns the actual schedule trigger), so the UI surfaces it as an
 *  on-demand check rather than a feed of alerts that don't really exist. */
export async function getCompetitorMovement(competitorId: string): Promise<MovementResult> {
  return apiClient.get<MovementResult>(`/brands/me/competitors/${competitorId}/movement`);
}
