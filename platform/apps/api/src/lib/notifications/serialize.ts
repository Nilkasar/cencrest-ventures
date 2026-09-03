/**
 * Epic 15 (Reporting & Notifications) response shape — shared by
 * `routes/notifications.ts`'s list and mark-read handlers, same "one
 * serializer, identical shape regardless of which route returned it"
 * precedent `lib/measurement/serialize.ts` already establishes.
 */
import type { notifications } from '@bebest/database';

export function serializeNotification(row: notifications) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    type: row.type,
    channel: row.channel,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    readAt: row.read_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}
