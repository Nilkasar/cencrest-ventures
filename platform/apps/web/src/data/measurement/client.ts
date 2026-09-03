import { apiClient, ApiError } from "@/lib/api-client";
import type { ActionMeasurementResponse, MeasurementsListResponse } from "./types";

/**
 * Epic 14 (Measurement & Learning Loop)'s data-access seam — same role
 * `data/actions/client.ts` plays for Epic 13. Every screen calls through
 * here, never `apiClient` directly. Calls `platform/apps/api`'s real,
 * tested routes from the first line, no fixture layer:
 *
 *   GET /api/actions/:id/measurement -> getActionMeasurement()
 *   GET /api/brands/me/measurements  -> listBrandMeasurements()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** A foreign/deleted action id — never a 403 that would confirm existence
 *  (tenant isolation), same flat-404 convention `action-measurement.ts`'s
 *  own `NOT_FOUND_ERROR` documents. Not expected from this screen's own
 *  flow (the action id always comes from an already-loaded `ActionCard`),
 *  but a real, named error regardless of how it's reached — same
 *  `ActionNotFoundError` precedent `data/actions/client.ts` sets. */
export class ActionNotFoundError extends Error {
  constructor(message = "That action couldn't be found.") {
    super(message);
    this.name = "ActionNotFoundError";
  }
}

/** Always 200 — `measured: false` before a measurement exists yet
 *  (`action.beforeScoreCapturedAt`/`.status`), `measured: true` with the
 *  full before/after comparison once one does. A caller polls this exactly
 *  like it polls AI-run status, never needing to distinguish "not
 *  measured yet" from a real error. */
export async function getActionMeasurement(actionId: string): Promise<ActionMeasurementResponse> {
  try {
    return await apiClient.get<ActionMeasurementResponse>(`/actions/${actionId}/measurement`);
  } catch (err) {
    if (isNotFound(err)) throw new ActionNotFoundError();
    throw err;
  }
}

/** `GET /brands/me/measurements` — the brand's full measurement history,
 *  sorted `measuredAt` desc. A 404 (no brand profile yet) degrades to an
 *  empty page, same "let the empty state carry it" precedent
 *  `getActionsOverview` (`data/actions/client.ts`) uses for the same
 *  situation — not currently rendered by any screen in this build (Epic
 *  14's UI surface is the delta-on-the-action-that-produced-it view, per
 *  the task brief), kept here so a future "measurement history" screen
 *  has a real data-access function to call rather than reinventing one. */
export async function listBrandMeasurements(params?: { limit?: number; offset?: number }): Promise<MeasurementsListResponse> {
  try {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    return await apiClient.get<MeasurementsListResponse>(`/brands/me/measurements${qs ? `?${qs}` : ""}`);
  } catch (err) {
    if (isNotFound(err)) return { items: [], total: 0, limit: params?.limit ?? 50, offset: params?.offset ?? 0 };
    throw err;
  }
}
