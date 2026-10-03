import { Hono } from 'hono';
import { PlatformDatabaseNotConfiguredError } from '@bebest/database/platform';
import type { EmailSender } from '../../lib/email.js';
import type { AppEnv } from '../../types/context.js';
import overview from './overview.js';
import capabilities from './capabilities.js';
import orgs from './orgs.js';
import { createUsersRoutes } from './users.js';
import agencies from './agencies.js';
import jobs from './jobs.js';
import audit from './audit.js';
import growth from './growth.js';
import { PLATFORM_DB_UNCONFIGURED } from './shared.js';

/**
 * Epic 22 Phase 1 — every Platform data route, mounted at `/api/platform`
 * (app.ts). `/session` (Phase 0) is mounted separately and unchanged.
 *
 * Each route file builds its own chain from `platformGuard` (auth → rate
 * limit → requirePlatformRole → platform DB configured). The `onError`
 * below is the backstop for the one failure that is configuration, not a
 * bug: `platformDb` used while `PLATFORM_DATABASE_URL` is unset → 503,
 * never a 500. Anything else is re-thrown to app.ts's handler.
 */
export function createPlatformRoutes(emailSender: EmailSender) {
  const platform = new Hono<AppEnv>();

  platform.route('/overview', overview);
  platform.route('/capabilities', capabilities);
  platform.route('/orgs', orgs);
  platform.route('/users', createUsersRoutes(emailSender));
  platform.route('/agencies', agencies);
  platform.route('/jobs', jobs);
  platform.route('/audit', audit);
  platform.route('/growth', growth);

  platform.onError((err, c) => {
    if (err instanceof PlatformDatabaseNotConfiguredError) return c.json(PLATFORM_DB_UNCONFIGURED, 503);
    throw err;
  });

  return platform;
}
