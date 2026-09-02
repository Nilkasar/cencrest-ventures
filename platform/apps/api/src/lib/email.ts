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
}
