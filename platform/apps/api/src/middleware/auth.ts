import type { MiddlewareHandler } from 'hono';
import { withUserContext } from '@bebest/database';
import { verifyAccessToken, InvalidAccessTokenError } from '../lib/jwt.js';
import type { AppEnv } from '../types/context.js';

/**
 * Verifies the `Authorization: Bearer <token>` access token and loads the
 * (still-active) user it belongs to. Sets `c.get('user')` for every
 * downstream handler/middleware. Does NOT resolve org/role — that is
 * `tenant-context` middleware's job, and it always re-reads role from the
 * database (never from this token) per SECURITY.md.
 *
 * Dev-only bypass: if BOTH `NODE_ENV !== 'production'` AND
 * `ALLOW_DEV_AUTH_BYPASS=true` are set, an `X-User-Id` header authenticates
 * as that user directly, skipping JWT verification entirely. This exists
 * so local development and integration tests don't require minting real
 * RS256 tokens for every request. It requires two separate opt-ins
 * (environment + explicit flag) specifically so it can never be
 * accidentally left on in a deployed environment by just forgetting to set
 * `NODE_ENV=production`.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    const devUserId = c.req.header('x-user-id');
    if (devUserId) {
      const user = await withUserContext(devUserId, (tx) => tx.users.findUnique({ where: { id: devUserId } }));
      if (user && !user.deleted_at) {
        c.set('user', { id: user.id, email: user.email, name: user.name, tokenOrgId: null });
        return next();
      }
    }
  }

  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  let payload;
  try {
    payload = await verifyAccessToken(authHeader.slice('Bearer '.length));
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    throw err;
  }

  const user = await withUserContext(payload.sub, (tx) => tx.users.findUnique({ where: { id: payload.sub } }));
  if (!user || user.deleted_at) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  c.set('user', { id: user.id, email: user.email, name: user.name, tokenOrgId: payload.org });
  return next();
};
