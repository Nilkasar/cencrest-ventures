/**
 * Epic 14 (Measurement & Learning Loop) — `GET /brands/:id/measurements`,
 * the spec's literal route, adapted to `/brands/me/measurements`, the same
 * single-brand-per-org convention every Epic 2+ route in `app.ts` already
 * uses (`getBrandForOrg` — never a fresh decision, applying an established
 * precedent). Sorted by `measured_at` desc, per the spec's own "sorted by
 * date" instruction.
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { serializeMeasurement } from '../lib/measurement/serialize.js';
import type { AppEnv } from '../types/context.js';

const measurementsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;

measurementsRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);

  const [rows, total] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.measurements.findMany({
        where: { organization_id: org.organizationId, brand_id: brand.id },
        orderBy: { measured_at: 'desc' },
        skip: offset,
        take: limit,
      }),
      tx.measurements.count({ where: { organization_id: org.organizationId, brand_id: brand.id } }),
    ]),
  );

  return c.json({ items: rows.map(serializeMeasurement), total, limit, offset });
});

export default measurementsRoute;
