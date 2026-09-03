/**
 * Epic 15 (Reporting & Notifications) — Notifications domain model. Mirrors
 * `apps/api/src/lib/notifications/serialize.ts` + `routes/notifications.ts`
 * field-for-field, and the Prisma `notification_type`/`notif_channel`
 * enums (`packages/database/prisma/schema.prisma`) exactly — the actual
 * backend source was read directly, not the epic spec's prose.
 */

/** Prisma `notification_type` enum, verbatim — every value that enum
 *  actually declares, including `entitlement_warning` (added per the
 *  spec's domain model but has no live server-side caller yet — the UI
 *  still needs a real label for it since the API type permits it). */
export type NotificationType =
  | "run_complete"
  | "new_recommendations"
  | "competitor_alert"
  | "score_change"
  | "agent_action"
  | "report_ready"
  | "action_assigned"
  | "billing_alert"
  | "weekly_digest"
  | "entitlement_warning";

export type NotificationChannel = "email" | "in_app";

/** `serializeNotification` — shared verbatim by `GET /notifications` (list)
 *  and `POST /notifications/:id/read` (mark-read). One row per channel
 *  actually attempted server-side (`notify()`'s design): a per-user
 *  notification with email delivery produces TWO rows (`channel: "in_app"`
 *  and `channel: "email"`) sharing the same `type`/`title`/`body` — the
 *  bell only ever lists `channel: "in_app"` rows (see `client.ts`'s
 *  `listNotifications`), so this duplication is never user-visible. */
export interface Notification {
  id: string;
  organizationId: string;
  /** `null` = an org-wide notification, visible to every member, never
   *  markable read (see `routes/notifications.ts`'s header comment for why
   *  — no per-user read-state column exists for an org-wide row in this
   *  build's schema). */
  userId: string | null;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  items: Notification[];
  total: number;
  limit: number;
  offset: number;
}
