/**
 * Epic 11 (Content Intelligence & Generation) — `GET /brands/me/content-briefs`
 * (the "active briefs" list `docs/09-ux/CUSTOMER_JOURNEY.md`'s Content
 * screen needs — not literally spelled out in the epic's terse "API
 * surface" list, but the same "the frontend needs a list endpoint for its
 * entity" precedent every prior epic's `GET /brands/me/<entity>` route
 * already sets, e.g. Epic 10's `routes/recommendations.ts`).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { serializeBrief } from '../lib/content/serialize.js';
import type { AppEnv } from '../types/context.js';

const contentBriefsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;

const listQuerySchema = z.object({
  status: z.enum(['draft', 'in_review', 'approved', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

contentBriefsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  const { status, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    deleted_at: null,
    ...(status ? { status } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.content_briefs.count({ where }),
      tx.content_briefs.findMany({ where, orderBy: { created_at: 'desc' }, skip: offset, take: limit }),
    ]),
  );

  return c.json({ briefs: rows.map(serializeBrief), pagination: { total, limit, offset } });
});

export default contentBriefsRoute;
