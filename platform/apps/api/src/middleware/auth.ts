import type { MiddlewareHandler } from 'hono';
import { db } from '@bebest/database';
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
 *
 * Both user lookups below read `users` through the un-scoped `db` client
 * rather than `withUserContext`. `users` is one of the tables deliberately
 * NOT under RLS (@bebest/database `0000_init/rls.sql`: "user-scoped, not
 * tenant-scoped. Protected by user_id ownership checks at the application
 * layer") — and here the user id being looked up comes from a
 * signature-verified token, not from client input. Wrapping it in
 * `withUserContext` bought no isolation the policy set doesn't already
 * define, but did cost a full interactive transaction — BEGIN, set_config,
 * SELECT, COMMIT — on every authenticated request. Against a managed
 * Postgres that is four network round trips instead of one, which measured
 * as ~0.75s of pure overhead per request on a ~250ms link.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    const devUserId = c.req.header('x-user-id');
    if (devUserId) {
      const user = await db.users.findUnique({ where: { id: devUserId } });
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

  const user = await db.users.findUnique({ where: { id: payload.sub } });
  if (!user || user.deleted_at) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  c.set('user', { id: user.id, email: user.email, name: user.name, tokenOrgId: payload.org });
  return next();
};
