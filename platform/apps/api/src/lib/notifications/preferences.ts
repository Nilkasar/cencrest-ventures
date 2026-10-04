/**
 * Epic 22 (Workspace Views) Phase 2 — per-user, per-organization
 * notification preferences (Settings > Notifications).
 *
 * Storage: `notification_preferences` (one row per organization, user,
 * notification type and channel; RLS `tenant_isolation` on organization_id —
 * migration 0024). A missing row means the DEFAULT, which is "enabled" for
 * both channels: that is exactly what `notify()` did before preferences
 * existed, so nobody's notifications change until they change a setting.
 * See packages/database/DECISIONS.md §32 for why the table (not
 * `users.settings` JSON) and why default-on.
 *
 * Only the types something actually emits are offered (grep `notify(`):
 *   run_complete         lib/agents/runner.ts — to the triggering user, or
 *                        org-wide for a schedule/event-triggered run
 *   report_ready         lib/reporting/notify-for-report.ts — to the creator
 *   weekly_digest        lib/reporting/notify-for-report.ts — to the creator
 *   competitor_alert     lib/reporting/notify-for-report.ts — org-wide only
 *   invitation_accepted  routes/orgs.ts — to the inviter
 * The other `notification_type` values have no emitter; offering a toggle
 * for them would be a setting that does nothing.
 *
 * How each preference is honoured (`notify.ts` + `routes/notifications.ts`):
 *   - per-user notification: `inApp: false` → no in-app row is written;
 *     `email: false` → no email row, no send.
 *   - org-wide notification (`user_id: null`): ONE shared in-app row is
 *     written, as before; a member with `inApp: false` for that type does not
 *     see it in `GET /notifications` (filtered at read time). Org-wide
 *     notifications are never emailed (unchanged — notify.ts's header), so
 *     `email` is not applicable to an org-only type (`emailApplicable`).
 */
import type { notification_type, PrismaTransactionClient } from '@bebest/database';

export const NOTIFICATION_PREFERENCE_TYPES = [
  'run_complete',
  'report_ready',
  'weekly_digest',
  'competitor_alert',
  'invitation_accepted',
] as const satisfies readonly notification_type[];

export type NotificationPreferenceType = (typeof NOTIFICATION_PREFERENCE_TYPES)[number];

export interface NotificationTypeMeta {
  label: string;
  description: string;
  /** False for a type only ever sent org-wide — org-wide notifications are
   * not emailed, so an email toggle for it would do nothing. */
  emailApplicable: boolean;
}

export const NOTIFICATION_TYPE_META: Record<NotificationPreferenceType, NotificationTypeMeta> = {
  run_complete: {
    label: 'Agent run finished',
    description: 'An agent run you started completed or failed.',
    emailApplicable: true,
  },
  report_ready: {
    label: 'Report ready',
    description: 'A report you generated is ready to read.',
    emailApplicable: true,
  },
  weekly_digest: {
    label: 'Weekly digest',
    description: 'Your weekly AI visibility digest is ready.',
    emailApplicable: true,
  },
  competitor_alert: {
    label: 'Competitor alert',
    description: "A competitor's AI visibility moved significantly (shared with the whole organization).",
    emailApplicable: false,
  },
  invitation_accepted: {
    label: 'Invitation accepted',
    description: 'Someone you invited joined the organization.',
    emailApplicable: true,
  },
};

export interface ChannelPreference {
  inApp: boolean;
  email: boolean;
}

export const DEFAULT_CHANNEL_PREFERENCE: Readonly<ChannelPreference> = Object.freeze({ inApp: true, email: true });

export function isNotificationPreferenceType(value: string): value is NotificationPreferenceType {
  return (NOTIFICATION_PREFERENCE_TYPES as readonly string[]).includes(value);
}

/** This user's effective preference for one type in one org. Must run
 * inside `withOrgContext(organizationId)` (RLS). A type with no offered
 * toggle (not in NOTIFICATION_PREFERENCE_TYPES) is always the default. */
export async function getChannelPreference(
  tx: PrismaTransactionClient,
  organizationId: string,
  userId: string,
  type: notification_type,
): Promise<ChannelPreference> {
  if (!isNotificationPreferenceType(type)) return { ...DEFAULT_CHANNEL_PREFERENCE };
  const rows = await tx.notification_preferences.findMany({
    where: { organization_id: organizationId, user_id: userId, notification_type: type },
    select: { channel: true, enabled: true },
  });
  const pref = { ...DEFAULT_CHANNEL_PREFERENCE };
  for (const row of rows) {
    if (row.channel === 'in_app') pref.inApp = row.enabled;
    if (row.channel === 'email') pref.email = row.enabled;
  }
  return pref;
}

/** Every offered type with this user's effective preference (defaults
 * filled in). Must run inside `withOrgContext(organizationId)`. */
export async function listChannelPreferences(
  tx: PrismaTransactionClient,
  organizationId: string,
  userId: string,
): Promise<Map<NotificationPreferenceType, ChannelPreference>> {
  const rows = await tx.notification_preferences.findMany({
    where: { organization_id: organizationId, user_id: userId },
    select: { notification_type: true, channel: true, enabled: true },
  });
  const map = new Map<NotificationPreferenceType, ChannelPreference>(
    NOTIFICATION_PREFERENCE_TYPES.map((t) => [t, { ...DEFAULT_CHANNEL_PREFERENCE }]),
  );
  for (const row of rows) {
    if (!isNotificationPreferenceType(row.notification_type)) continue;
    const pref = map.get(row.notification_type)!;
    if (row.channel === 'in_app') pref.inApp = row.enabled;
    if (row.channel === 'email') pref.email = row.enabled;
  }
  return map;
}

/** Types this user has switched OFF in-app — used to hide org-wide rows in
 * `GET /notifications`. Must run inside `withOrgContext(organizationId)`. */
export async function inAppDisabledTypes(
  tx: PrismaTransactionClient,
  organizationId: string,
  userId: string,
): Promise<notification_type[]> {
  const rows = await tx.notification_preferences.findMany({
    where: { organization_id: organizationId, user_id: userId, channel: 'in_app', enabled: false },
    select: { notification_type: true },
  });
  return rows.map((r) => r.notification_type);
}
