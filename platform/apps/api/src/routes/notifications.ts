/**
 * Epic 15 (Reporting & Notifications) — `GET /notifications`, `POST
 * /notifications/:id/read`, the spec's literal routes, matching exactly
 * (no brand-scoping — notifications are org/user-scoped, addressed by
 * their own id, same convention `/api/ai-runs/:id` etc. already use).
 *
 * A caller sees their OWN per-user notifications plus every ORG-WIDE one
 * (`user_id: null`) — enforced by this route's own explicit WHERE clause,
 * on top of (never instead of) `withOrgContext`'s RLS organization_id
 * boundary. See @bebest/database DECISIONS.md §29's "per-user visibility
 * is an application-layer concern, not RLS's" note for why that split is
 * correct rather than a gap.
 *
 * `POST /:id/read` is intentionally restricted to a caller's OWN per-user
 * notification (`user_id = caller`) — an org-wide row has no per-user
 * read-state column in this build's schema (marking it "read" would hide
 * it for every member, not just the caller), so attempting to mark one
 * read 404s exactly like a foreign-org row would, rather than silently
 * doing the wrong thing. Documented scope boundary, not an oversight — see
 * this epic's backend doc.
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { serializeNotification } from '../lib/notifications/serialize.js';
import { inAppDisabledTypes } from '../lib/notifications/preferences.js';
import type { AppEnv } from '../types/context.js';

const notificationsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const NOT_FOUND_ERROR = { error: 'Notification not found' } as const;

notificationsRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const user = c.get('user');

  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 25) || 25));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);

  // Epic 22 Phase 2:
  //   - `channel: 'in_app'` — this is the in-app (bell) list. Before, the
  //     `email` audit-trail row of every emailed notification was listed
  //     too, so each one appeared twice, and an email row would have shown
  //     in the bell even with the in-app channel switched off.
  //   - an ORG-WIDE row of a type this member switched off in-app is hidden
  //     (per-user rows are never written in that case — notify.ts).
  const [rows, total] = await withOrgContext(org.organizationId, async (tx) => {
    const hiddenOrgWideTypes = await inAppDisabledTypes(tx, org.organizationId, user.id);
    const where = {
      organization_id: org.organizationId,
      channel: 'in_app' as const,
      OR: [
        { user_id: user.id },
        hiddenOrgWideTypes.length > 0
          ? { user_id: null, type: { notIn: hiddenOrgWideTypes } }
          : { user_id: null },
      ],
    };
    return Promise.all([
      tx.notifications.findMany({ where, orderBy: { created_at: 'desc' }, skip: offset, take: limit }),
      tx.notifications.count({ where }),
    ]);
  });

  return c.json({ items: rows.map(serializeNotification), total, limit, offset });
});

notificationsRoute.post('/:id/read', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const notificationId = c.req.param('id');

  const existing = await withOrgContext(org.organizationId, (tx) =>
    tx.notifications.findFirst({ where: { id: notificationId, organization_id: org.organizationId, user_id: user.id } }),
  );
  if (!existing) return c.json(NOT_FOUND_ERROR, 404);

  const row = await withOrgContext(org.organizationId, (tx) =>
    tx.notifications.update({ where: { id: existing.id }, data: { read_at: existing.read_at ?? new Date() } }),
  );

  return c.json({ notification: serializeNotification(row) });
});

export default notificationsRoute;
