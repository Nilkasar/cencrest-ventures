import { Resend } from 'resend'
import { db } from './db.js'

export type NotificationPayload = {
  userId: string
  orgId: string
  type: 'run_complete' | 'new_recommendations' | 'competitor_alert' | 'score_change' | 'agent_action' | 'report_ready' | 'action_assigned' | 'billing_alert'
  title: string
  body?: string
  actionUrl?: string
}

async function getPreference(userId: string, type: NotificationPayload['type'], channel: 'in_app' | 'email'): Promise<boolean> {
  const pref = await db.notification_preferences.findUnique({
    where: { user_id_notification_type_channel: { user_id: userId, notification_type: type, channel } },
  })
  // Default: enabled if no preference record
  return pref ? pref.enabled : true
}

export async function sendNotification(payload: NotificationPayload): Promise<void> {
  const inAppEnabled = await getPreference(payload.userId, payload.type, 'in_app')

  if (inAppEnabled) {
    await db.notifications.create({
      data: {
        user_id: payload.userId,
        org_id: payload.orgId,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        action_url: payload.actionUrl ?? null,
      },
    })
  }

  const emailEnabled = await getPreference(payload.userId, payload.type, 'email')
  if (!emailEnabled) return
  if (!process.env.RESEND_API_KEY) return

  const user = await db.users.findUnique({ where: { id: payload.userId } })
  if (!user) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const textBody = [payload.body, payload.actionUrl].filter(Boolean).join('\n\n')

  await resend.emails.send({
    from: 'notifications@bebestwith.ai',
    to: user.email,
    subject: payload.title,
    text: textBody,
  })
}

export async function sendBulkNotification(
  userIds: string[],
  orgId: string,
  payload: Omit<NotificationPayload, 'userId' | 'orgId'>,
): Promise<void> {
  // Process in batches of 10
  for (let i = 0; i < userIds.length; i += 10) {
    const batch = userIds.slice(i, i + 10)
    await Promise.all(batch.map((userId) => sendNotification({ ...payload, userId, orgId })))
  }
}
