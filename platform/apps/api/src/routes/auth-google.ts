import { Hono } from 'hono';
import { createHmac, randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { db } from '@bebest/database';
import { signAccessToken, refreshTokenExpiry, generateRefreshToken } from '../lib/jwt.js';
import { generateOpaqueToken } from '../lib/tokens.js';
import { clientIp } from '../lib/client-ip.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types/context.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const STATE_SECRET = process.env.GOOGLE_OAUTH_STATE_SECRET ?? 'bebest-dev-state-secret-change-in-production';
const SCOPES = ['openid', 'email', 'profile'];

function getRedirectUri(): string {
  return process.env.GOOGLE_LOGIN_REDIRECT_URI
    ?? 'https://bebest-api.vercel.app/api/auth/google/callback';
}

function signState(nonce: string): string {
  const payload = JSON.stringify({ nonce, purpose: 'login' });
  const hmac = createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${hmac}`;
}

function verifyState(state: string): boolean {
  const dot = state.lastIndexOf('.');
  if (dot === -1) return false;
  const encoded = state.slice(0, dot);
  const receivedHmac = state.slice(dot + 1);
  const json = Buffer.from(encoded, 'base64url').toString('utf8');
  const expectedHmac = createHmac('sha256', STATE_SECRET).update(json).digest('hex');
  if (receivedHmac !== expectedHmac) return false;
  const payload = JSON.parse(json) as { purpose?: string };
  return payload.purpose === 'login';
}

const router = new Hono<AppEnv>();

// ── Initiate Google login ────────────────────────────────────────────────────
router.get('/', authRateLimit, (c) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return c.json({ error: 'google_oauth_not_configured', message: 'Google OAuth credentials are not configured.' }, 503);
  }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri());
  const state = signState(randomUUID());
  const url = oauth2Client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: SCOPES,
    state,
  });

  return c.redirect(url);
});

// ── Google callback ──────────────────────────────────────────────────────────
router.get('/callback', async (c) => {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const fail = (reason: string) => c.redirect(`${appUrl}/auth/google/callback?error=${reason}`);

  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  if (errorParam === 'access_denied') return fail('denied');
  if (!code || !state) return fail('invalid');
  if (!verifyState(state)) return fail('invalid');

  try {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri());
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: googleUser } = await oauth2.userinfo.get();

    if (!googleUser.email || !googleUser.verified_email) return fail('unverified');

    // Upsert user
    let user = await db.users.findUnique({ where: { email: googleUser.email } });
    if (!user) {
      user = await db.users.create({
        data: {
          email: googleUser.email!,
          name: googleUser.name ?? (googleUser.email!.split('@')[0] ?? 'User'),
          email_verified: true,
          avatar_url: googleUser.picture ?? null as string | null,
        },
      });
    } else {
      user = await db.users.update({
        where: { id: user.id },
        data: {
          email_verified: true,
          last_login_at: new Date(),
          ...(googleUser.picture && !user.avatar_url ? { avatar_url: googleUser.picture } : {}),
        },
      });
    }
    await db.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });

    // Issue session
    const session = await db.sessions.create({
      data: {
        user_id: user.id,
        token_hash: generateOpaqueToken(32).hash,
        expires_at: refreshTokenExpiry(),
        ip_address: clientIp(c),
        user_agent: c.req.header('user-agent') ?? null,
      },
    });

    const { token: refreshToken, hash } = generateRefreshToken();
    await db.refresh_tokens.create({
      data: {
        user_id: user.id,
        session_id: session.id,
        token_hash: hash,
        expires_at: refreshTokenExpiry(),
      },
    });

    const accessToken = await signAccessToken({ sub: user.id, email: user.email, org: null });

    return c.redirect(
      `${appUrl}/auth/google/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`,
    );
  } catch {
    return fail('failed');
  }
});

export default router;
