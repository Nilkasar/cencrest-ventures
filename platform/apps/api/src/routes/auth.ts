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
import { authRateLimit, authenticatedRateLimit } from '../middleware/rate-limit.js';
import { auditLog } from '../middleware/audit-log.js';
import { resolveAgencyAccess } from '../lib/agency-access.js';
import { clientIp } from '../lib/client-ip.js';
import type { AppEnv } from '../types/context.js';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resolves an org the given user may act as — direct membership first, then
 * an active agency link — or `null`. Shared by `/select-org` and `/refresh`
 * so the two can never drift on what "may act as" means.
 */
async function resolveSelectableOrg(
  userId: string,
  slug: string,
): Promise<{ id: string; name: string; slug: string; role: string; viaAgencyOrgId?: string } | null> {
  const org = await db.organizations.findUnique({ where: { slug } });
  if (!org || org.deleted_at) return null;

  const membership = await withUserContext(userId, (tx) =>
    tx.memberships.findFirst({ where: { organization_id: org.id, user_id: userId } }),
  );
  if (membership) {
    return { id: org.id, name: org.name, slug: org.slug, role: membership.role };
  }

  const agencyAccess = await resolveAgencyAccess(userId, org.id);
  if (!agencyAccess) return null;

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: agencyAccess.role,
    viaAgencyOrgId: agencyAccess.agencyOrgId,
  };
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
    const parsed = z
      .object({
        refreshToken: z.string().min(1),
        // Which org the caller was acting as. Optional, and a request —
        // not a grant: access is re-verified below exactly the way
        // `/select-org` verifies it, so passing a slug you have no access
        // to simply yields an org-less token, never an elevated one.
        orgSlug: z.string().min(1).max(255).optional(),
      })
      .safeParse(body);
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

    // Re-attach the org the caller was acting as, if they told us which one
    // and still have access to it. A refresh token carries no org claim of
    // its own, so without this the new access token came back org-less and
    // EVERY org-scoped route 409'd until the client thought to call
    // `/select-org` again — which meant a page reload silently logged the
    // user out of their own organization. Access is re-derived here from
    // `memberships` (then agency links), never trusted from the request.
    const organization = parsed.data.orgSlug
      ? await resolveSelectableOrg(user.id, parsed.data.orgSlug)
      : null;

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      org: organization?.id ?? null,
    });

    return c.json({
      accessToken,
      refreshToken: newRefreshToken,
      // Echoed so a client can tell "my org came back" from "it didn't"
      // without decoding the token.
      organization: organization
        ? { id: organization.id, name: organization.name, slug: organization.slug }
        : null,
    });
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
  // Epic 18 (Agency / White Label / Integrations): when the caller has no
  // DIRECT membership in the requested org, this now also tries
  // `resolveAgencyAccess` before rejecting — the same composed check
  // `middleware/tenant-context.ts`'s `resolveOrgContext` uses, so an agency
  // user can obtain a token for a client org they only reach via an active
  // `agency_clients` link. This mint is still just a HINT: the `org` claim
  // on the resulting token is re-verified (membership AND agency access,
  // fresh) by `resolveOrgContext` on every subsequent request — minting a
  // token here grants nothing by itself, and a link revoked a moment later
  // blocks the very next request regardless of what this token claims.
  auth.post('/select-org', requireAuth, authenticatedRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ slug: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Organization slug required' }, 400);

    const user = c.get('user');
    const exists = await db.organizations.findUnique({ where: { slug: parsed.data.slug } });
    if (!exists || exists.deleted_at) return c.json({ error: 'Organization not found' }, 404);

    const organization = await resolveSelectableOrg(user.id, parsed.data.slug);
    if (!organization) return c.json({ error: 'Forbidden' }, 403);

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      org: organization.id,
    });
    return c.json({ accessToken, organization });
  });

  // ── /me ───────────────────────────────────────────────────────────────────
  auth.get('/me', requireAuth, authenticatedRateLimit, async (c) => {
    const authUser = c.get('user');

    // Epic 19 (Production Hardening), item 6 — capped server-side for
    // consistency with every other list endpoint in this codebase, though
    // this one is naturally small (memberships for a single user), same as
    // routes/orgs.ts's GET / list.
    const memberships = await withUserContext(authUser.id, (tx) =>
      tx.memberships.findMany({
        where: { user_id: authUser.id },
        include: {
          organizations: { select: { id: true, name: true, slug: true, deleted_at: true } },
        },
        take: 100,
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
