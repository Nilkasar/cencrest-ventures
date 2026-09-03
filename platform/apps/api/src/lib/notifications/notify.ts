/**
 * Epic 15 (Reporting & Notifications) — the ONE shared notification
 * mechanism `docs/13-agents/AGENT_ARCHITECTURE.md`'s "notify user (email +
 * in-app)" pattern calls for, reused everywhere. This epic's spec is
 * explicit: every prior epic that produces something worth telling a
 * customer about (an agent run completing, a competitor's score moving, an
 * entitlement limit approaching) should route through this function rather
 * than inventing its own email-sending logic.
 *
 * ── What was actually found when grepping for "ad hoc notification logic"
 * (this epic's own explicit instruction) ─────────────────────────────────
 * Neither Epic 12 (Agents) nor Epic 8 (Competitive Intelligence) has a real
 * parallel email-sending code path to delete:
 *   - Epic 12's `lib/agents/runner.ts` header comment says so verbatim —
 *     "no email/notification infra to wire step 9 into yet." Its `run_
 *     complete`-shaped moment (a run finishing, success or failure) existed
 *     only as a DB status update; this epic wires the FIRST real call
 *     there — see `executeAgentRun`'s new `notify(...)` call.
 *   - Epic 8's `lib/ai-visibility/competitive.ts` header comment says the
 *     same — "the schedule trigger is deferred to Epic 12's Competitor
 *     Agent" (never built). `computeCompetitorMovement` is a pure
 *     comparison function with no caller that ever sends anything; this
 *     epic's own weekly-digest generator (`lib/reporting/generate-
 *     report.ts`) is the first real, recurring trigger point that computes
 *     movement and can fire a `competitor_alert` — see `notify-for-
 *     report.ts`.
 *   - `send_notification` (`lib/agents/tool-permissions.ts`) is a
 *     PERMISSION list entry an agent is allowed to invoke, never an actual
 *     implementation — no concrete agent step calls it. Wiring a real
 *     agent tool-execution path is out of scope for this epic (agents
 *     don't currently have a generic tool-dispatch loop to hang it off of)
 *     and is left as a documented gap in this epic's backend doc, not
 *     invented here as a parallel mechanism.
 * So "consolidate" concretely means: this file IS the mechanism those two
 * epics' own comments were waiting for, and both now have a real call site
 * into it (agent-run completion directly; competitor movement via report
 * generation) rather than a second one being built alongside it.
 *
 * ── Design ────────────────────────────────────────────────────────────
 * One row is written per channel actually attempted:
 *   - `in_app` — ALWAYS written, immediately "sent" (a bell-icon row has no
 *     real delivery step).
 *   - `email` — written and delivery attempted ONLY when `userId` is set
 *     AND that user has a real email on file. Org-wide notifications
 *     (`userId` omitted/null) are in-app only in this build — email
 *     fan-out to "every member of an org" has no single natural recipient
 *     and is left as a documented, honest gap (this epic's backend doc),
 *     not guessed at with an arbitrary "just email the owner" rule.
 * Email delivery failure never throws (same "never take down the caller"
 * convention `lib/audit.ts`'s `writeAuditEvent` already establishes) — the
 * in_app row (and the audit trail) is the durable record regardless of
 * whether the email provider is reachable.
 *
 * `deps.emailSender` defaults to a fresh `ConsoleEmailSender` when omitted
 * — the exact same "optional deps, defaulted at the call site" shape
 * `lib/free-snapshot/orchestrator.ts`'s `runFreeSnapshotPipeline` already
 * uses for the same reason: this is library code, not a route module, so
 * `app.ts`'s "one EmailSender construction site" rule (aimed at route
 * wiring) doesn't apply the same way here. `routes/reports.ts` and
 * `routes/report-details.ts` (real route modules) thread the app's real
 * `emailSender` through instead of relying on this default.
 */
import { withOrgContext, db, type notifications, type notification_type } from '@bebest/database';
import { ConsoleEmailSender, type EmailSender } from '../email.js';
import { writeAuditEvent } from '../audit.js';

export interface NotifyParams {
  organizationId: string;
  /** Omit or pass `null` for an org-wide notification (visible to every
   * member via `GET /notifications`, never emailed — see this file's
   * header comment). */
  userId?: string | null;
  type: notification_type;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  /** Set `false` to skip the email attempt even for a per-user
   * notification (e.g. a channel the caller already knows has no useful
   * recipient). Defaults to `true`. */
  email?: boolean;
}

export interface NotifyResult {
  inApp: notifications;
  /** `null` when no email was attempted (org-wide, `email: false`, or no
   * resolvable recipient) — NOT the same as "attempted and failed," which
   * is still a real row with `sent_at: null` (see the audit trail's own
   * `result` field for that distinction). */
  email: notifications | null;
}

export interface NotifyDeps {
  emailSender?: EmailSender;
}

export async function notify(params: NotifyParams, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const emailSender = deps.emailSender ?? new ConsoleEmailSender();
  const userId = params.userId ?? null;

  const inApp = await withOrgContext(params.organizationId, (tx) =>
    tx.notifications.create({
      data: {
        organization_id: params.organizationId,
        user_id: userId,
        type: params.type,
        channel: 'in_app',
        title: params.title,
        body: params.body ?? null,
        action_url: params.actionUrl ?? null,
        sent_at: new Date(),
      },
    }),
  );

  await writeAuditEvent({
    userId: null,
    organizationId: params.organizationId,
    actorType: 'system',
    action: 'notification.sent',
    entityType: 'notification',
    entityId: inApp.id,
    result: 'success',
    details: { type: params.type, channel: 'in_app', targetUserId: userId },
  });

  let emailRow: notifications | null = null;

  if (params.email !== false && userId) {
    const user = await db.users.findUnique({ where: { id: userId } });

    if (user?.email) {
      emailRow = await withOrgContext(params.organizationId, (tx) =>
        tx.notifications.create({
          data: {
            organization_id: params.organizationId,
            user_id: userId,
            type: params.type,
            channel: 'email',
            title: params.title,
            body: params.body ?? null,
            action_url: params.actionUrl ?? null,
            sent_at: null, // set below only after a successful send
          },
        }),
      );

      let sendSucceeded = true;
      try {
        await emailSender.sendNotification({ to: user.email, subject: params.title, body: params.body ?? params.title });
      } catch (err) {
        sendSucceeded = false;
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'notification_email_send_failed',
            notificationId: emailRow.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      if (sendSucceeded) {
        emailRow = await withOrgContext(params.organizationId, (tx) =>
          tx.notifications.update({ where: { id: emailRow!.id }, data: { sent_at: new Date() } }),
        );
      }

      await writeAuditEvent({
        userId: null,
        organizationId: params.organizationId,
        actorType: 'system',
        action: 'notification.sent',
        entityType: 'notification',
        entityId: emailRow.id,
        result: sendSucceeded ? 'success' : 'failure',
        details: { type: params.type, channel: 'email', targetUserId: userId },
      });
    }
  }

  return { inApp, email: emailRow };
}
