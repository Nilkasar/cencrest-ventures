import { apiClient, ApiError } from "@/lib/api-client";
import type { Notification, NotificationsListResponse } from "./types";

/**
 * Epic 15 (Reporting & Notifications)'s data-access seam for the
 * notification bell. Calls `platform/apps/api`'s real, tested routes from
 * the first line, no fixture layer:
 *
 *   GET  /api/notifications          -> listNotifications()
 *   POST /api/notifications/:id/read -> markNotificationRead()
 *
 * `GET /notifications` returns every channel the shared `notify()`
 * function wrote (`in_app` AND `email`) for a per-user notification that
 * also got emailed — `notify()`'s own design writes one row per channel
 * actually attempted, both sharing the same `type`/`title`/`body`/
 * `createdAt` (see `data/notifications/types.ts`'s header comment). A bell
 * is an `in_app` surface; `listNotifications` below filters to
 * `channel: "in_app"` client-side so a caller never sees the same event
 * rendered twice. This means the raw `total`/pagination numbers the API
 * returns are NOT the bell's true item/unread count (they include the
 * email-channel duplicates) — this function recomputes both from the
 * filtered set instead of passing the server's numbers through, a
 * documented, deliberate divergence from the "never re-sort/re-derive a
 * server-paginated list" convention `listOpportunities` otherwise follows,
 * necessary because no server-side `channel` filter exists on this route.
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export interface NotificationsPage {
  items: Notification[];
  /** Count of `channel: "in_app"` items within THIS fetched page only —
   *  not a server-computed grand total (see this file's header comment). */
  total: number;
  unreadCount: number;
}

/** Fetches one page (`limit`, default 50 — generous enough that the bell's
 *  in-app rows are rarely truncated by the email-duplicate rows sharing
 *  the same page) and filters to in-app rows. A 404 (no org context yet)
 *  degrades to an empty page, same "let the empty state carry it"
 *  precedent every other list fetcher in this codebase uses. */
export async function listNotifications(params: { limit?: number } = {}): Promise<NotificationsPage> {
  const limit = params.limit ?? 50;
  try {
    const response = await apiClient.get<NotificationsListResponse>(`/notifications?limit=${limit}&offset=0`);
    const items = response.items.filter((n) => n.channel === "in_app");
    return { items, total: items.length, unreadCount: items.filter((n) => n.readAt === null).length };
  } catch (err) {
    if (isNotFound(err)) return { items: [], total: 0, unreadCount: 0 };
    throw err;
  }
}

/** Restricted server-side to the caller's OWN per-user notification — an
 *  org-wide row (`userId: null`) 404s here exactly like a foreign-org row
 *  would (`routes/notifications.ts`'s documented scope boundary: no
 *  per-user read-state column exists for an org-wide row in this build).
 *  Callers must not offer a "mark read" affordance on an org-wide item. */
export async function markNotificationRead(id: string): Promise<Notification> {
  const { notification } = await apiClient.post<{ notification: Notification }>(`/notifications/${id}/read`);
  return notification;
}
