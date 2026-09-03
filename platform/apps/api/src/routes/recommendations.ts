/**
 * Epic 10 (Recommendation Engine) — `GET /brands/:id/recommendations`
 * (`docs/epics/10-recommendation-engine.md`'s "API surface"), adapted to
 * `/brands/me/recommendations` — same single-brand-per-org convention every
 * Epic 2+ brand-child resource in `app.ts` already uses.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { serializeRecommendation } from '../lib/recommendations/serialize.js';
import type { AppEnv } from '../types/context.js';

const recommendationsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;

const listQuerySchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'dismissed']).optional(),
  actionType: z.enum(['create_page', 'update_page', 'fix_technical', 'build_citations']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── GET / — list, sorted by priority_rank desc (this epic's spec's literal
// "sorted by priority_rank"; DESC because higher priority_rank means
// "rank first," same convention `unified_opportunities.opportunity_score`
// itself already uses — see lib/recommendations/generator.ts's header
// comment). ─────────────────────────────────────────────────────────────
recommendationsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  const { status, actionType, limit, offset } = parsed.data;

  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const where = {
    organization_id: org.organizationId,
    brand_id: brand.id,
    ...(status ? { status } : {}),
    ...(actionType ? { action_type: actionType } : {}),
  };

  const [total, rows] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.opportunity_recommendations.count({ where }),
      tx.opportunity_recommendations.findMany({
        where,
        orderBy: [{ priority_rank: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]),
  );

  return c.json({
    recommendations: rows.map(serializeRecommendation),
    pagination: { total, limit, offset },
  });
});

export default recommendationsRoute;
