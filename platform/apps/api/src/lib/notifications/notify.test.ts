import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EmailSender } from '../email.js';

function fakeEmailSender(sendNotification: EmailSender['sendNotification'] = vi.fn()): EmailSender {
  return { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification };
}

const db = {
  users: { findUnique: vi.fn() },
  notifications: { create: vi.fn(), update: vi.fn() },
  notification_preferences: { findMany: vi.fn() },
  audit_events: { create: vi.fn() },
};

// writeAuditEvent runs org-attributed writes inside withOrgContext now
// (see lib/audit.ts), so the transaction client exposes audit_events.
const tx = {
  notifications: db.notifications,
  audit_events: db.audit_events,
  notification_preferences: db.notification_preferences,
};

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

let rowsById: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  vi.clearAllMocks();
  rowsById = {};
  db.audit_events.create.mockResolvedValue({});
  db.notification_preferences.findMany.mockResolvedValue([]); // no rows = defaults (both channels on)
  let seq = 0;
  db.notifications.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `notif-${++seq}`, ...data };
    rowsById[row.id] = row;
    return row;
  });
  db.notifications.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = { ...rowsById[where.id], ...data };
    rowsById[where.id] = row;
    return row;
  });
});

describe('notify()', () => {
  it('always writes an in_app row, immediately "sent"', async () => {
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Your report is ready', email: false });

    expect(result.inApp).toMatchObject({ organization_id: 'org-1', user_id: 'user-1', type: 'report_ready', channel: 'in_app' });
    expect(result.inApp!.sent_at).toBeInstanceOf(Date);
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'notification.sent', result: 'success' }) }),
    );
  });

  it('org-wide notifications (no userId) are in_app only — no email attempted, no recipient lookup', async () => {
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', type: 'competitor_alert', title: 'CompetitorA moved' });

    expect(result.inApp!.user_id).toBeNull();
    expect(result.email).toBeNull();
    expect(db.users.findUnique).not.toHaveBeenCalled();
  });

  it('attempts email delivery for a per-user notification with a resolvable address, and marks sent_at once it succeeds', async () => {
    db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    const emailSender = fakeEmailSender(vi.fn().mockResolvedValue(undefined));
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready', body: 'body text' }, { emailSender });

    expect(emailSender.sendNotification).toHaveBeenCalledWith({ to: 'ada@example.com', subject: 'Ready', body: 'body text' });
    expect(result.email).toMatchObject({ channel: 'email', user_id: 'user-1' });
    expect(result.email!.sent_at).toBeInstanceOf(Date);
  });

  it('a user with no email on file gets no email row at all, not a failed one', async () => {
    db.users.findUnique.mockResolvedValue({ id: 'user-1', email: null });
    const emailSender = fakeEmailSender();
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready' }, { emailSender });

    expect(result.email).toBeNull();
    expect(emailSender.sendNotification).not.toHaveBeenCalled();
  });

  it('email: false skips the email attempt even for a per-user notification', async () => {
    db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    const emailSender = fakeEmailSender();
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready', email: false }, { emailSender });

    expect(result.email).toBeNull();
    expect(emailSender.sendNotification).not.toHaveBeenCalled();
  });

  it('an email-send failure never throws — the email row is still created, with sent_at left null and a failure audit event', async () => {
    db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    const emailSender = fakeEmailSender(vi.fn().mockRejectedValue(new Error('provider down')));
    const { notify } = await import('./notify.js');

    const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready' }, { emailSender });

    expect(result.email).toMatchObject({ channel: 'email' });
    expect(result.email!.sent_at).toBeNull();
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'notification.sent', result: 'failure' }) }),
    );
  });

  it('defaults to a ConsoleEmailSender when no emailSender dep is provided — never throws for lack of one', async () => {
    db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    const { notify } = await import('./notify.js');

    await expect(notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready' })).resolves.toBeDefined();
  });

  // ── Epic 22 Phase 2: per-user, per-org preferences ─────────────────────
  describe('preferences', () => {
    it('a disabled EMAIL preference: no email row, no send — the in-app row is still written', async () => {
      db.notification_preferences.findMany.mockResolvedValue([{ channel: 'email', enabled: false }]);
      db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
      const emailSender = fakeEmailSender();
      const { notify } = await import('./notify.js');

      const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'report_ready', title: 'Ready' }, { emailSender });

      expect(emailSender.sendNotification).not.toHaveBeenCalled();
      expect(result.email).toBeNull();
      expect(result.inApp).toMatchObject({ channel: 'in_app' });
      expect(result.suppressed).toEqual(['email']);
      expect(db.notifications.create).toHaveBeenCalledTimes(1);
      expect(db.users.findUnique).not.toHaveBeenCalled();
      // The preference read is scoped to this org, this user, this type.
      expect(db.notification_preferences.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organization_id: 'org-1', user_id: 'user-1', notification_type: 'report_ready' } }),
      );
    });

    it('a disabled IN-APP preference: no in-app row; email still goes out', async () => {
      db.notification_preferences.findMany.mockResolvedValue([{ channel: 'in_app', enabled: false }]);
      db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
      const emailSender = fakeEmailSender(vi.fn().mockResolvedValue(undefined));
      const { notify } = await import('./notify.js');

      const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'run_complete', title: 'Done' }, { emailSender });

      expect(result.inApp).toBeNull();
      expect(result.suppressed).toEqual(['in_app']);
      expect(emailSender.sendNotification).toHaveBeenCalledTimes(1);
      expect(db.notifications.create).toHaveBeenCalledTimes(1);
      expect(db.notifications.create.mock.calls[0]![0].data.channel).toBe('email');
    });

    it('both channels off: nothing written, nothing sent, no audit row', async () => {
      db.notification_preferences.findMany.mockResolvedValue([
        { channel: 'in_app', enabled: false },
        { channel: 'email', enabled: false },
      ]);
      const emailSender = fakeEmailSender();
      const { notify } = await import('./notify.js');

      const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'invitation_accepted', title: 'Joined' }, { emailSender });

      expect(result).toEqual({ inApp: null, email: null, suppressed: ['in_app', 'email'] });
      expect(db.notifications.create).not.toHaveBeenCalled();
      expect(emailSender.sendNotification).not.toHaveBeenCalled();
      expect(db.audit_events.create).not.toHaveBeenCalled();
    });

    it('an explicit enabled row behaves like the default', async () => {
      db.notification_preferences.findMany.mockResolvedValue([{ channel: 'email', enabled: true }]);
      db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
      const emailSender = fakeEmailSender(vi.fn().mockResolvedValue(undefined));
      const { notify } = await import('./notify.js');
      const result = await notify({ organizationId: 'org-1', userId: 'user-1', type: 'weekly_digest', title: 'Digest' }, { emailSender });
      expect(result.suppressed).toEqual([]);
      expect(emailSender.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('org-wide notifications do not read any single member preferences — the shared row is written (filtered per member at read time)', async () => {
      const { notify } = await import('./notify.js');
      const result = await notify({ organizationId: 'org-1', type: 'competitor_alert', title: 'Moved' });
      expect(result.inApp).toMatchObject({ user_id: null });
      expect(db.notification_preferences.findMany).not.toHaveBeenCalled();
    });

    it('a type with no offered toggle (no emitter) always uses the defaults', async () => {
      db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
      const { notify } = await import('./notify.js');
      await notify({ organizationId: 'org-1', userId: 'user-1', type: 'billing_alert', title: 'x', email: false });
      expect(db.notification_preferences.findMany).not.toHaveBeenCalled();
    });
  });
});
