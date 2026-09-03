/**
 * Epic 10 (Recommendation Engine) — `PATCH /recommendations/:id` (status
 * transitions, audit-logged — `docs/epics/10-recommendation-engine.md`'s
 * "API surface" and end-to-end flow step 5). Same id-addressed,
 * brand-agnostic split `routes/opportunity-details.ts` uses for
 * `unified_opportunities`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit-log.js';
import { serializeRecommendation } from '../lib/recommendations/serialize.js';
import type { AppEnv } from '../types/context.js';

const recommendationDetailsRoute = new Hono<AppEnv>();

const MUTATE = 'create_brand_profile' as const;
const NOT_FOUND_ERROR = { error: 'Recommendation not found' } as const;

const patchSchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'dismissed']),
});

recommendationDetailsRoute.patch(
  '/:id',
  requireAuth,
  authenticatedRateLimit,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  auditLog({ action: 'recommendation.status_changed', entityType: 'opportunity_recommendation' }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

    const org = c.get('org');
    const user = c.get('user');

    // Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit
    // WHERE) as `opportunity-details.ts` — a foreign id 404s, never a 403
    // that would confirm it exists (tenant isolation — this epic's
    // end-to-end flow step 6).
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.opportunity_recommendations.findFirst({ where: { id: c.req.param('id'), organization_id: org.organizationId } }),
    );
    if (!existing) return c.json(NOT_FOUND_ERROR, 404);

    const updated = await withOrgContext(org.organizationId, (tx) =>
      tx.opportunity_recommendations.update({
        where: { id: existing.id },
        data: { status: parsed.data.status, updated_by: user.id, updated_at: new Date() },
      }),
    );

    return c.json(serializeRecommendation(updated));
  },
);

export default recommendationDetailsRoute;
