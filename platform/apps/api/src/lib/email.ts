import { Resend } from 'resend';

/**
 * Email delivery abstraction (ADR-010: Resend).
 *
 * Route/handler code depends on this interface, never on a concrete
 * provider. The single construction site is in app.ts — it picks
 * ResendEmailSender when RESEND_API_KEY is set, falls back to
 * ConsoleEmailSender otherwise (dev/test with zero external dependency).
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

const FROM = 'BeBest <hello@bebestwithai.com>';

export class ResendEmailSender implements EmailSender {
  private readonly resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendMagicLink({ to, magicLinkUrl }: { to: string; magicLinkUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: FROM,
      to,
      subject: 'Your BeBest sign-in link',
      html: `<p>Click the link below to sign in to BeBest. This link expires in 15 minutes.</p>
<p><a href="${magicLinkUrl}">Sign in to BeBest</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
      text: `Sign in to BeBest: ${magicLinkUrl}\n\nThis link expires in 15 minutes. If you didn't request this, ignore this email.`,
    });
  }

  async sendInvitation({ to, organizationName, inviteUrl }: { to: string; organizationName: string; inviteUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: FROM,
      to,
      subject: `You've been invited to join ${organizationName} on BeBest`,
      html: `<p>You've been invited to join <strong>${organizationName}</strong> on BeBest.</p>
<p><a href="${inviteUrl}">Accept invitation</a></p>`,
      text: `You've been invited to join ${organizationName} on BeBest. Accept here: ${inviteUrl}`,
    });
  }

  async sendSnapshotReady({ to, reportUrl }: { to: string; reportUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: FROM,
      to,
      subject: 'Your AI Visibility Snapshot is ready',
      html: `<p>Your AI Visibility Snapshot report is ready.</p>
<p><a href="${reportUrl}">View your report</a></p>`,
      text: `Your AI Visibility Snapshot is ready. View it here: ${reportUrl}`,
    });
  }

  async sendNotification({ to, subject, body }: { to: string; subject: string; body: string }): Promise<void> {
    await this.resend.emails.send({
      from: FROM,
      to,
      subject,
      html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
      text: body,
    });
  }
}
