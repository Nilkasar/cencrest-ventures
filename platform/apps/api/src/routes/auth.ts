import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { db, withUserContext } from '@bebest/database';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from '../lib/jwt.js';
import { generateOpaqueToken } from '../lib/tokens.js';
import type { EmailSender } from '../lib/email.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { auditLog } from '../middleware/audit-log.js';
import type { AppEnv } from '../types/context.js';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

function clientIp(c: Context<AppEnv>): string {
  return c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Auth routes — magic-link only (SECURITY.md's primary auth method; no
 * password auth in Epic 0, see apps/api/DECISIONS.md). Takes an
 * `EmailSender` so the actual delivery mechanism (console log today,
 * Resend later — ADR-010) is swappable without touching any route logic.
 */
export function createAuthRoutes(emailSender: EmailSender) {
  const auth = new Hono<AppEnv>();

  // ── Request a magic link ────────────────────────────────────────────────
  const magicLinkSchema = z.object({ email: z.string().email() });

  auth.post('/magic-link', authRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = magicLinkSchema.safeParse(body);
    if (!parsed.success) {
      // Same response whether the email is malformed or just doesn't
      // exist yet — magic link always "succeeds" from the caller's
      // perspective so this endpoint can't be used to enumerate accounts.
      return c.json({ success: true });
    }

    const { email } = parsed.data;
    const { token, hash } = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

    await db.magic_link_tokens.create({
      data: { email, token_hash: hash, expires_at: expiresAt },
    });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    await emailSender.sendMagicLink({
      to: email,
      magicLinkUrl: `${appUrl}/auth/magic-link/verify?token=${token}`,
    });

    return c.json({ success: true });
  });

  // ── Verify a magic link, log in (creating the user on first use) ────────
  auth.post(
    '/magic-link/verify',
    auditLog({ action: 'auth.login', entityType: 'user', actorType: 'user' }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = z.object({ token: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return c.json({ error: 'Token required' }, 400);

      const tokenHash = hashToken(parsed.data.token);
      const mlt = await db.magic_link_tokens.findFirst({ where: { token_hash: tokenHash } });

      if (!mlt) return c.json({ error: 'Invalid token' }, 404);
      if (mlt.used_at) return c.json({ error: 'Token already used' }, 400);
      if (mlt.expires_at < new Date()) return c.json({ error: 'Token expired' }, 410);

      await db.magic_link_tokens.update({ where: { id: mlt.id }, data: { used_at: new Date() } });

      let user = await db.users.findUnique({ where: { email: mlt.email } });
      if (!user) {
        user = await db.users.create({
          data: {
            email: mlt.email,
            name: mlt.email.split('@')[0] ?? mlt.email,
            email_verified: true,
          },
        });
      } else if (!user.email_verified) {
        user = await db.users.update({ where: { id: user.id }, data: { email_verified: true } });
      }
      await db.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });

      const { accessToken, refreshToken } = await issueSession(user.id, user.email, c);
      return c.json({
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, name: user.name },
      });
    },
  );

  // ── Refresh (rotating) ───────────────────────────────────────────────────
  auth.post('/refresh', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Refresh token required' }, 400);

    const tokenHash = hashToken(parsed.data.refreshToken);
    const stored = await db.refresh_tokens.findUnique({ where: { token_hash: tokenHash } });

    if (!stored || stored.revoked_at || stored.expires_at < new Date()) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    if (stored.session_id) {
      const session = await db.sessions.findUnique({ where: { id: stored.session_id } });
      if (!session || session.revoked_at) {
        return c.json({ error: 'Session revoked' }, 401);
      }
    }

    const user = await db.users.findUnique({ where: { id: stored.user_id } });
    if (!user || user.deleted_at) return c.json({ error: 'User not found' }, 401);

    // Rotate: revoke the old refresh token, issue a new one under the same session.
    await db.refresh_tokens.update({ where: { id: stored.id }, data: { revoked_at: new Date() } });

    const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
    await db.refresh_tokens.create({
      data: {
        user_id: user.id,
        session_id: stored.session_id,
        token_hash: newHash,
        expires_at: refreshTokenExpiry(),
      },
    });
    if (stored.session_id) {
      await db.sessions.update({
        where: { id: stored.session_id },
        data: { last_seen_at: new Date() },
      });
    }

    // Preserve whatever org was active on the token being refreshed by
    // re-deriving it the same way `/select-org` does — but we don't have
    // the old access token here (only the refresh token), so the new
    // access token is issued WITHOUT an org claim. Clients should call
    // `/select-org` again after a refresh if they need continued org
    // context; this is a known rough edge, documented in README.md.
    const accessToken = await signAccessToken({ sub: user.id, email: user.email, org: null });

    return c.json({ accessToken, refreshToken: newRefreshToken });
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  auth.post(
    '/logout',
    auditLog({ action: 'auth.logout', entityType: 'user', actorType: 'user' }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const token = typeof body?.refreshToken === 'string' ? body.refreshToken : null;
      if (token) {
        const tokenHash = hashToken(token);
        const stored = await db.refresh_tokens.findUnique({ where: { token_hash: tokenHash } });
        if (stored) {
          await db.refresh_tokens.update({
            where: { id: stored.id },
            data: { revoked_at: new Date() },
          });
          if (stored.session_id) {
            await db.sessions
              .update({ where: { id: stored.session_id }, data: { revoked_at: new Date() } })
              .catch(() => {});
          }
        }
      }
      return c.json({ success: true });
    },
  );

  // ── Select an organization (issues a new, org-scoped access token) ──────
  auth.post('/select-org', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ slug: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Organization slug required' }, 400);

    const user = c.get('user');
    const org = await db.organizations.findUnique({ where: { slug: parsed.data.slug } });
    if (!org || org.deleted_at) return c.json({ error: 'Organization not found' }, 404);

    const membership = await withUserContext(user.id, (tx) =>
      tx.memberships.findFirst({ where: { organization_id: org.id, user_id: user.id } }),
    );
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const accessToken = await signAccessToken({ sub: user.id, email: user.email, org: org.id });
    return c.json({
      accessToken,
      organization: { id: org.id, name: org.name, slug: org.slug, role: membership.role },
    });
  });

  // ── /me ───────────────────────────────────────────────────────────────────
  auth.get('/me', requireAuth, async (c) => {
    const authUser = c.get('user');

    const memberships = await withUserContext(authUser.id, (tx) =>
      tx.memberships.findMany({
        where: { user_id: authUser.id },
        include: {
          organizations: { select: { id: true, name: true, slug: true, deleted_at: true } },
        },
      }),
    );

    return c.json({
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      organizations: memberships
        .filter((m) => !m.organizations.deleted_at)
        .map((m) => ({
          id: m.organizations.id,
          name: m.organizations.name,
          slug: m.organizations.slug,
          role: m.role,
        })),
    });
  });

  return auth;

  /** Shared login-success path: creates a session row, an initial refresh
   * token under it, and signs the first access token (no org claim yet —
   * the client calls `/select-org` next). */
  async function issueSession(userId: string, email: string, c: Context<AppEnv>) {
    const session = await db.sessions.create({
      data: {
        user_id: userId,
        token_hash: generateOpaqueToken(32).hash,
        expires_at: refreshTokenExpiry(),
        ip_address: clientIp(c),
        user_agent: c.req.header('user-agent') ?? null,
      },
    });

    const { token: refreshToken, hash } = generateRefreshToken();
    await db.refresh_tokens.create({
      data: {
        user_id: userId,
        session_id: session.id,
        token_hash: hash,
        expires_at: refreshTokenExpiry(),
      },
    });

    const accessToken = await signAccessToken({ sub: userId, email, org: null });
    return { accessToken, refreshToken };
  }
}
