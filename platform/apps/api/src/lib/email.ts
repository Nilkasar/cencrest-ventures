/**
 * Email delivery abstraction (ADR-010: Resend, not wired up yet).
 *
 * Route/handler code depends on this interface, never on a concrete
 * provider. Swapping in Resend later means writing one new class and
 * changing the single call site in `server.ts`/`app.ts` that constructs
 * the sender — no route or middleware code changes.
 */
export interface EmailSender {
  sendMagicLink(params: { to: string; magicLinkUrl: string }): Promise<void>;
  sendInvitation(params: {
    to: string;
    organizationName: string;
    inviteUrl: string;
  }): Promise<void>;
  /**
   * Epic 17 (Free AI + SEO Growth Snapshot) — step 4 of the epic's flow:
   * "send an email with a link to the web report" once the orchestrated
   * pipeline (crawl + queries + AI run + SEO analysis + report) finishes.
   * Same swappable-provider contract as the other two methods: dev/test
   * gets `ConsoleEmailSender` below, a later epic wires a real
   * `ResendEmailSender` with zero route/orchestrator changes.
   */
  sendSnapshotReady(params: { to: string; reportUrl: string }): Promise<void>;
  /**
   * Epic 15 (Reporting & Notifications) — the email half of
   * `lib/notifications/notify.ts`'s shared `notify()` function, the ONE
   * mechanism every notification in this codebase (agent-run completion,
   * competitor movement, report-ready) should route through instead of
   * each epic inventing its own email-sending call. Deliberately generic
   * (subject/body, not a bespoke method per notification type) — unlike
   * `sendMagicLink`/`sendInvitation`/`sendSnapshotReady` above, which each
   * have their own fixed template because their content shape never
   * varies, a notification's title/body varies per `notification_type`,
   * so one templated method covers all of them rather than growing a new
   * interface method per type as this epic's notification vocabulary
   * grows.
   */
  sendNotification(params: { to: string; subject: string; body: string }): Promise<void>;
}

/**
 * Development/test stub: logs instead of sending. This is intentionally
 * the default so Epic 0 has zero external dependency on an email provider
 * or API key. Wire up a `ResendEmailSender implements EmailSender` in a
 * later epic once `RESEND_API_KEY` and domain verification (ADR-010) are
 * in place — every call site already goes through `EmailSender`, so no
 * route changes are needed then.
 */
export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink({ to, magicLinkUrl }: { to: string; magicLinkUrl: string }): Promise<void> {
    // eslint-disable-next-line no-console -- deliberate: this class IS the dev-mode "delivery"
    console.log(`[dev email] magic link for ${to}: ${magicLinkUrl}`);
  }

  async sendInvitation(params: {
    to: string;
    organizationName: string;
    inviteUrl: string;
  }): Promise<void> {
    // eslint-disable-next-line no-console -- deliberate: this class IS the dev-mode "delivery"
    console.log(
      `[dev email] invitation for ${params.to} to join "${params.organizationName}": ${params.inviteUrl}`,
    );
  }

  async sendSnapshotReady({ to, reportUrl }: { to: string; reportUrl: string }): Promise<void> {
    // eslint-disable-next-line no-console -- deliberate: this class IS the dev-mode "delivery"
    console.log(`[dev email] AI Visibility Snapshot ready for ${to}: ${reportUrl}`);
  }

  async sendNotification({ to, subject, body }: { to: string; subject: string; body: string }): Promise<void> {
    // eslint-disable-next-line no-console -- deliberate: this class IS the dev-mode "delivery"
    console.log(`[dev email] notification for ${to} — ${subject}: ${body}`);
  }
}
