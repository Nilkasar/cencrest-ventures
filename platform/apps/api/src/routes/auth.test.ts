import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';
import type { EmailSender } from '../lib/email.js';

const db = {
  magic_link_tokens: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  users: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  sessions: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  refresh_tokens: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
    fn({ memberships: db.memberships, users: db.users }),
  ),
}));

class FakeEmailSender implements EmailSender {
  sent: Array<{ to: string; url: string }> = [];
  async sendMagicLink({ to, magicLinkUrl }: { to: string; magicLinkUrl: string }) {
    this.sent.push({ to, url: magicLinkUrl });
  }
  async sendInvitation(): Promise<void> {}
}

async function buildApp() {
  const { createAuthRoutes } = await import('./auth.js');
  const sender = new FakeEmailSender();
  const app = new Hono();
  app.route('/auth', createAuthRoutes(sender));
  return { app, sender };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);
});

describe('POST /auth/magic-link', () => {
  it('always returns success, even for an invalid email (no user enumeration)', async () => {
    const { app } = await buildApp();
    const res = await app.request('/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('creates a magic_link_tokens row and sends the email for a valid address', async () => {
    db.magic_link_tokens.create.mockResolvedValue({});
    const { app, sender } = await buildApp();

    const res = await app.request('/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    });

    expect(res.status).toBe(200);
    expect(db.magic_link_tokens.create).toHaveBeenCalledTimes(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe('ada@example.com');
  });
});

describe('POST /auth/magic-link/verify', () => {
  it('404s for an unknown token', async () => {
    db.magic_link_tokens.findFirst.mockResolvedValue(null);
    const { app } = await buildApp();

    const res = await app.request('/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bogus' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an already-used token', async () => {
    db.magic_link_tokens.findFirst.mockResolvedValue({
      id: 'mlt-1',
      used_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
      email: 'ada@example.com',
    });
    const { app } = await buildApp();

    const res = await app.request('/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'used' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    db.magic_link_tokens.findFirst.mockResolvedValue({
      id: 'mlt-1',
      used_at: null,
      expires_at: new Date(Date.now() - 60_000),
      email: 'ada@example.com',
    });
    const { app } = await buildApp();

    const res = await app.request('/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'expired' }),
    });
    expect(res.status).toBe(410);
  });

  it('creates a new user on first login and issues tokens + a session', async () => {
    db.magic_link_tokens.findFirst.mockResolvedValue({
      id: 'mlt-1',
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      email: 'new@example.com',
    });
    db.magic_link_tokens.update.mockResolvedValue({});
    db.users.findUnique.mockResolvedValue(null);
    db.users.create.mockResolvedValue({
      id: 'user-1',
      email: 'new@example.com',
      name: 'new',
      email_verified: true,
    });
    db.users.update.mockResolvedValue({});
    db.sessions.create.mockResolvedValue({ id: 'session-1' });
    db.refresh_tokens.create.mockResolvedValue({});

    const { app } = await buildApp();
    const res = await app.request('/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fresh' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      user: unknown;
    };
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    expect(body.user).toEqual({ id: 'user-1', email: 'new@example.com', name: 'new' });
    expect(db.users.create).toHaveBeenCalledTimes(1);
    expect(db.sessions.create).toHaveBeenCalledTimes(1);
    expect(db.refresh_tokens.create).toHaveBeenCalledTimes(1);
  });

  it('logs in an existing user without creating a duplicate', async () => {
    db.magic_link_tokens.findFirst.mockResolvedValue({
      id: 'mlt-1',
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      email: 'existing@example.com',
    });
    db.magic_link_tokens.update.mockResolvedValue({});
    db.users.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'existing@example.com',
      name: 'Existing',
      email_verified: true,
    });
    db.users.update.mockResolvedValue({});
    db.sessions.create.mockResolvedValue({ id: 'session-2' });
    db.refresh_tokens.create.mockResolvedValue({});

    const { app } = await buildApp();
    const res = await app.request('/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ok' }),
    });

    expect(res.status).toBe(200);
    expect(db.users.create).not.toHaveBeenCalled();
  });
});

describe('POST /auth/refresh', () => {
  it('rejects an unknown refresh token', async () => {
    db.refresh_tokens.findUnique.mockResolvedValue(null);
    const { app } = await buildApp();

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a revoked refresh token', async () => {
    db.refresh_tokens.findUnique.mockResolvedValue({
      id: 'rt-1',
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
      user_id: 'user-1',
      session_id: null,
    });
    const { app } = await buildApp();

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'revoked' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when the associated session has been revoked (logout-everywhere path)', async () => {
    db.refresh_tokens.findUnique.mockResolvedValue({
      id: 'rt-1',
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user_id: 'user-1',
      session_id: 'session-1',
    });
    db.sessions.findUnique.mockResolvedValue({ id: 'session-1', revoked_at: new Date() });
    const { app } = await buildApp();

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rotates: revokes the old token and issues a new one', async () => {
    db.refresh_tokens.findUnique.mockResolvedValue({
      id: 'rt-1',
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user_id: 'user-1',
      session_id: 'session-1',
    });
    db.sessions.findUnique.mockResolvedValue({ id: 'session-1', revoked_at: null });
    db.users.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      deleted_at: null,
    });
    db.refresh_tokens.update.mockResolvedValue({});
    db.refresh_tokens.create.mockResolvedValue({});
    db.sessions.update.mockResolvedValue({});

    const { app } = await buildApp();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'valid' }),
    });

    expect(res.status).toBe(200);
    expect(db.refresh_tokens.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1' } }),
    );
    expect(db.refresh_tokens.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /auth/select-org', () => {
  it('403s when the caller has no membership in the requested org', async () => {
    const { signAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({ sub: 'user-1', email: 'a@example.com', org: null });

    db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme' });
    db.memberships.findFirst.mockResolvedValue(null);
    db.users.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const { app } = await buildApp();
    const res = await app.request('/auth/select-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug: 'acme' }),
    });
    expect(res.status).toBe(403);
  });

  it('issues a new access token with the org claim set when membership exists', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({ sub: 'user-1', email: 'a@example.com', org: null });

    db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme' });
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    db.users.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Ada',
      deleted_at: null,
    });

    const { app } = await buildApp();
    const res = await app.request('/auth/select-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug: 'acme' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      organization: { role: string };
    };
    const verified = await verifyAccessToken(body.accessToken);
    expect(verified.org).toBe('org-1');
    expect(body.organization.role).toBe('admin');
  });
});
