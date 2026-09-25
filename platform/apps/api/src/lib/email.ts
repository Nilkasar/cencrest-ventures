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
 * Thrown by `ResendEmailSender` when the provider rejects a send. A distinct
 * class (not a bare `Error`) so a caller that wants to distinguish "the email
 * provider is unhappy" from any other failure can, and so the thrown value
 * carries the template's subject without carrying the recipient address or
 * body into a log line.
 */
export class EmailSendError extends Error {
  constructor(
    readonly subject: string,
    readonly providerMessage: string,
  ) {
    super(`Email send failed ("${subject}"): ${providerMessage}`);
    this.name = 'EmailSendError';
  }
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

/**
 * The envelope `From`. Never hardcoded to one address: `EMAIL_FROM` wins,
 * and the default below is the address root `CLAUDE.md` documents for the
 * brand (`hello@bebestwithai.com`). Read fresh from `process.env` per
 * construction rather than at module load, matching the
 * `BILLING_WEBHOOK_SECRET`/`getWebhookSecret()` convention in
 * `lib/billing/payment-provider.ts`.
 *
 * Whatever this resolves to, the domain must be verified in Resend (ADR-010)
 * or every send fails with a 403 — which, since `#send` below now throws,
 * would surface immediately as a failed magic-link request rather than as
 * silence.
 */
export const DEFAULT_EMAIL_FROM = 'BeBest <hello@bebestwithai.com>';

/** Escapes the five HTML-significant characters before any caller-supplied
 * value is interpolated into an email body. `organizationName` (an org's own
 * name), and a notification's `subject`/`body`, are user- or
 * AI-pipeline-derived strings — and `docs/08-security/SECURITY.md`'s rule
 * that AI/crawled content is untrusted data does not stop applying because
 * the sink happens to be an email instead of a web page. Without this, an
 * org named `<img src=x onerror=…>` ships that markup into every invite
 * email its members receive. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Real transactional delivery via Resend (ADR-010). Selected over
 * `ConsoleEmailSender` by `app.ts` when `RESEND_API_KEY` is set, and only
 * then — dev and CI keep the console sender and stay free of any external
 * dependency.
 *
 * **Failures throw.** This is the whole reason `#send` exists rather than
 * each method calling the SDK inline: `resend.emails.send()` does NOT reject
 * on an API error — it RESOLVES with `{ data: null, error: {...} }`. Awaiting
 * it without inspecting `error` means a rejected send (unverified domain,
 * revoked key, suppressed recipient, rate limit) looks exactly like a
 * successful one. Since magic link is the only sign-in method, that failure
 * mode is "the login button silently does nothing, forever," which is
 * indistinguishable from working software from the server's side.
 *
 * Throwing is correct for every caller because each one already decided what
 * it wants:
 *   - `routes/auth.ts` (magic link) awaits with no catch -> a failed send
 *     becomes a real 5xx instead of a lying `{ success: true }`.
 *   - `routes/orgs.ts` (invitation) likewise.
 *   - `lib/notifications/notify.ts` (Epic 15 digests/alerts) already wraps
 *     its send in try/catch, logs `notification_email_send_failed`, leaves
 *     `sent_at` null and writes a `result: 'failure'` audit row — so a
 *     background digest still cannot be taken down by a provider outage.
 *   - `lib/free-snapshot/orchestrator.ts` already `.catch()`es its send for
 *     the same reason.
 * No call site needed changing; they were all written against a sender that
 * throws, and until now none of them had one.
 */
export class ResendEmailSender implements EmailSender {
  private readonly resend: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string = process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM) {
    this.resend = new Resend(apiKey);
    this.from = from;
  }

  /** The single send path. Turns Resend's `{ data, error }` result into a
   * thrown error — see this class's doc comment for why that matters more
   * than it looks. */
  private async send(params: { to: string; subject: string; html: string; text: string }): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      // Never include `params.to`'s full address or the body in the message —
      // this string reaches logs and, for the magic-link path, an error
      // response. The recipient is already on the `notifications` row / audit
      // trail for the flows that persist one.
      throw new EmailSendError(params.subject, error.message ?? error.name ?? 'unknown Resend error');
    }
  }

  async sendMagicLink({ to, magicLinkUrl }: { to: string; magicLinkUrl: string }): Promise<void> {
    const url = escapeHtml(magicLinkUrl);
    await this.send({
      to,
      subject: 'Your BeBest sign-in link',
      html: `<p>Click the link below to sign in to BeBest. This link expires in 15 minutes.</p>
<p><a href="${url}">Sign in to BeBest</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
      text: `Sign in to BeBest: ${magicLinkUrl}\n\nThis link expires in 15 minutes. If you didn't request this, ignore this email.`,
    });
  }

  async sendInvitation({
    to,
    organizationName,
    inviteUrl,
  }: {
    to: string;
    organizationName: string;
    inviteUrl: string;
  }): Promise<void> {
    const org = escapeHtml(organizationName);
    const url = escapeHtml(inviteUrl);
    await this.send({
      to,
      subject: `You've been invited to join ${organizationName} on BeBest`,
      html: `<p>You've been invited to join <strong>${org}</strong> on BeBest.</p>
<p><a href="${url}">Accept invitation</a></p>`,
      text: `You've been invited to join ${organizationName} on BeBest. Accept here: ${inviteUrl}`,
    });
  }

  async sendSnapshotReady({ to, reportUrl }: { to: string; reportUrl: string }): Promise<void> {
    const url = escapeHtml(reportUrl);
    await this.send({
      to,
      subject: 'Your AI Visibility Snapshot is ready',
      html: `<p>Your AI Visibility Snapshot report is ready.</p>
<p><a href="${url}">View your report</a></p>`,
      text: `Your AI Visibility Snapshot is ready. View it here: ${reportUrl}`,
    });
  }

  async sendNotification({ to, subject, body }: { to: string; subject: string; body: string }): Promise<void> {
    await this.send({
      to,
      subject,
      html: `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
      text: body,
    });
  }
}

/**
 * The single environment-driven construction site for `EmailSender`, shared
 * by the HTTP process (`app.ts`) and the worker process (`worker.ts`).
 *
 * It exists because of the HTTP/worker split: the free-snapshot job's handler
 * needs a sender, and before the split it only ever got one from `app.ts`'s
 * inline `new ResendEmailSender(...) : new ConsoleEmailSender()` expression.
 * Two processes choosing their sender with two copies of that expression is
 * how one of them ends up silently on `ConsoleEmailSender` in production —
 * i.e. how a customer's snapshot-ready email never sends. Same
 * "one factory, selected from env" shape as
 * `lib/billing/payment-provider.ts`'s `createPaymentProviderFromEnv`.
 */
export function createEmailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender {
  return env.RESEND_API_KEY ? new ResendEmailSender(env.RESEND_API_KEY) : new ConsoleEmailSender();
}
