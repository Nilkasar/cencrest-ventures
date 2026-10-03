import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth.js';
import { authenticatedRateLimit } from '../../middleware/rate-limit.js';
import { requirePlatformRole } from '../../middleware/platform-role.js';
import type { AppEnv } from '../../types/context.js';

/**
 * Epic 22, Phase 0 — `GET /api/platform/session`.
 *
 * The only Platform route in Phase 0. It exists so the guard is provably
 * wired end to end before any route that reads across tenants is built:
 * auth → rate limit → `requirePlatformRole` (fresh DB read of
 * `users.platform_role` + a `platform_access_events` row) → handler. It
 * reads no tenant data, so it does not touch `platformDb`.
 */
const session = new Hono<AppEnv>();

session.get('/', requireAuth, authenticatedRateLimit, requirePlatformRole('support'), (c) => {
  const user = c.get('user');
  return c.json({
    platformRole: c.get('platformRole'),
    user: { id: user.id, email: user.email, name: user.name },
  });
});

export default session;
