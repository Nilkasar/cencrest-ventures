/**
 * `ConsoleEmailSender` / `ResendEmailSender`.
 *
 * The `resend` module is mocked at the module boundary, so ZERO outbound
 * requests are made. What is actually being tested is the thing that makes
 * this class safe to put in front of production login: `resend.emails.send()`
 * RESOLVES with `{ data: null, error: {...} }` on an API failure instead of
 * rejecting, so an adapter that merely `await`s it reports success for every
 * rejected send. Magic link is the only sign-in method, so that failure mode
 * is a silent, total production login outage.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const send = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
    constructor(public readonly apiKey: string) {}
  },
}));

const { ConsoleEmailSender, ResendEmailSender, EmailSendError, DEFAULT_EMAIL_FROM } = await import('./email.js');

const ORIGINAL_FROM = process.env.EMAIL_FROM;

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null });
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL_FROM;
});

function lastCall() {
  return send.mock.calls.at(-1)?.[0] as {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}

describe('ConsoleEmailSender — the default when RESEND_API_KEY is unset', () => {
  it('never throws and never touches the Resend SDK', async () => {
    const sender = new ConsoleEmailSender();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(sender.sendMagicLink({ to: 'a@example.com', magicLinkUrl: 'https://x/y' })).resolves.toBeUndefined();
    await expect(sender.sendInvitation({ to: 'a@example.com', organizationName: 'Acme', inviteUrl: 'https://x/i' })).resolves.toBeUndefined();
    await expect(sender.sendSnapshotReady({ to: 'a@example.com', reportUrl: 'https://x/r' })).resolves.toBeUndefined();
    await expect(sender.sendNotification({ to: 'a@example.com', subject: 'S', body: 'B' })).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('ResendEmailSender — from address is configuration, never hardcoded', () => {
  it('defaults to the documented brand address', async () => {
    await new ResendEmailSender('re_test').sendMagicLink({ to: 'a@example.com', magicLinkUrl: 'https://app/x' });
    expect(lastCall().from).toBe(DEFAULT_EMAIL_FROM);
    expect(DEFAULT_EMAIL_FROM).toContain('bebestwithai.com');
  });

  it('honours EMAIL_FROM', async () => {
    process.env.EMAIL_FROM = 'BeBest <no-reply@app.bebestwithai.com>';
    await new ResendEmailSender('re_test').sendMagicLink({ to: 'a@example.com', magicLinkUrl: 'https://app/x' });
    expect(lastCall().from).toBe('BeBest <no-reply@app.bebestwithai.com>');
  });

  it('honours an explicit constructor override over the environment', async () => {
    process.env.EMAIL_FROM = 'env@example.com';
    await new ResendEmailSender('re_test', 'explicit@example.com').sendMagicLink({
      to: 'a@example.com',
      magicLinkUrl: 'https://app/x',
    });
    expect(lastCall().from).toBe('explicit@example.com');
  });
});

describe('ResendEmailSender — a provider rejection must surface as a thrown error', () => {
  const sender = () => new ResendEmailSender('re_test');

  it('sendMagicLink throws when Resend resolves with an error (the critical login path)', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Domain is not verified' } });

    await expect(
      sender().sendMagicLink({ to: 'ada@example.com', magicLinkUrl: 'https://app/verify?token=t' }),
    ).rejects.toThrow(EmailSendError);
  });

  it('the thrown error names the template and the provider reason, and leaks neither recipient nor body', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Domain is not verified' } });

    await expect(
      sender().sendMagicLink({ to: 'ada@example.com', magicLinkUrl: 'https://app/verify?token=secret-token' }),
    ).rejects.toThrow(/Your BeBest sign-in link.*Domain is not verified/);

    let thrown: unknown;
    try {
      await sender().sendMagicLink({
        to: 'ada@example.com',
        magicLinkUrl: 'https://app/verify?token=secret-token',
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EmailSendError);
    const message = (thrown as Error).message;
    expect(message).not.toContain('ada@example.com');
    expect(message).not.toContain('secret-token');
  });

  it('every other template throws on a provider error too', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } });
    const s = sender();

    await expect(s.sendInvitation({ to: 'a@example.com', organizationName: 'Acme', inviteUrl: 'https://x/i' })).rejects.toThrow(EmailSendError);
    await expect(s.sendSnapshotReady({ to: 'a@example.com', reportUrl: 'https://x/r' })).rejects.toThrow(EmailSendError);
    await expect(s.sendNotification({ to: 'a@example.com', subject: 'Digest', body: 'body' })).rejects.toThrow(EmailSendError);
  });

  it('resolves silently on success', async () => {
    await expect(
      sender().sendMagicLink({ to: 'a@example.com', magicLinkUrl: 'https://app/x' }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('propagates a genuine network rejection from the SDK as well', async () => {
    send.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(sender().sendMagicLink({ to: 'a@example.com', magicLinkUrl: 'https://app/x' })).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});

describe('ResendEmailSender — every transactional template the app actually sends', () => {
  it('magic link carries the URL in both HTML and plain text', async () => {
    await new ResendEmailSender('re_test').sendMagicLink({
      to: 'ada@example.com',
      magicLinkUrl: 'https://app.bebestwithai.com/auth/magic-link/verify?token=abc',
    });
    const call = lastCall();
    expect(call.to).toBe('ada@example.com');
    expect(call.subject).toBe('Your BeBest sign-in link');
    expect(call.html).toContain('https://app.bebestwithai.com/auth/magic-link/verify?token=abc');
    expect(call.text).toContain('https://app.bebestwithai.com/auth/magic-link/verify?token=abc');
  });

  it('invitation carries the org name and accept URL', async () => {
    await new ResendEmailSender('re_test').sendInvitation({
      to: 'grace@example.com',
      organizationName: 'Acme Ltd',
      inviteUrl: 'https://app.bebestwithai.com/invitations/accept?token=t',
    });
    const call = lastCall();
    expect(call.subject).toContain('Acme Ltd');
    expect(call.html).toContain('Acme Ltd');
    expect(call.html).toContain('https://app.bebestwithai.com/invitations/accept?token=t');
  });

  it('snapshot-ready carries the report URL (Epic 17 orchestrator)', async () => {
    await new ResendEmailSender('re_test').sendSnapshotReady({
      to: 'lead@example.com',
      reportUrl: 'https://app.bebestwithai.com/snapshot/r/1',
    });
    expect(lastCall().html).toContain('https://app.bebestwithai.com/snapshot/r/1');
  });

  it('notification passes the caller subject/body through (Epic 15 notify/digests)', async () => {
    await new ResendEmailSender('re_test').sendNotification({
      to: 'ada@example.com',
      subject: 'Weekly digest',
      body: 'Line one\nLine two',
    });
    const call = lastCall();
    expect(call.subject).toBe('Weekly digest');
    expect(call.html).toContain('Line one<br>Line two');
    expect(call.text).toBe('Line one\nLine two');
  });
});

describe('ResendEmailSender — untrusted values are escaped before reaching HTML', () => {
  it('escapes an organization name (an org names itself; SECURITY.md treats that as untrusted)', async () => {
    await new ResendEmailSender('re_test').sendInvitation({
      to: 'a@example.com',
      organizationName: '<img src=x onerror="alert(1)">',
      inviteUrl: 'https://x/i',
    });
    const call = lastCall();
    expect(call.html).not.toContain('<img');
    expect(call.html).toContain('&lt;img');
  });

  it('escapes a notification body (Epic 15 bodies can be AI-pipeline derived)', async () => {
    await new ResendEmailSender('re_test').sendNotification({
      to: 'a@example.com',
      subject: 'Alert',
      body: '<script>steal()</script>',
    });
    expect(lastCall().html).not.toContain('<script>');
    expect(lastCall().html).toContain('&lt;script&gt;');
  });

  it('escapes a URL before interpolating it into an href', async () => {
    await new ResendEmailSender('re_test').sendMagicLink({
      to: 'a@example.com',
      magicLinkUrl: 'https://app/x?a=1"><script>x()</script>',
    });
    expect(lastCall().html).not.toContain('<script>');
  });
});
