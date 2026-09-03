/**
 * Epic 10 (Recommendation Engine) — `POST /opportunities/:id/recommendations/
 * generate` (`docs/epics/10-recommendation-engine.md`'s "API surface").
 * Mounted at the SAME base path as `routes/opportunity-details.ts`
 * (`/api/opportunities`) — Hono merges routes from multiple routers mounted
 * at one base path (the exact precedent `/api/brands/me/competitors` already
 * uses for `routes/competitors.ts` + `routes/competitor-ai-runs.ts`), so this
 * stays its own file rather than growing `opportunity-details.ts` with a
 * different epic's concern.
 *
 * Idempotent upsert on `(organization_id, opportunity_id)` — same discipline
 * Epic 9's `POST .../recompute` uses for `(organization_id, brand_id,
 * query_id)`: a second consecutive call updates the SAME row in place,
 * never creates a duplicate (this epic's spec, verbatim).
 */
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { generateRecommendationForOpportunity } from '../lib/recommendations/generate-for-opportunity.js';
import { serializeRecommendation } from '../lib/recommendations/serialize.js';
import type { AppEnv } from '../types/context.js';

const opportunityRecommendationsRoute = new Hono<AppEnv>();

const MUTATE = 'create_brand_profile' as const;
const NOT_FOUND_ERROR = { error: 'Opportunity not found' } as const;

// The brief-generation logic itself now lives in
// `lib/recommendations/generate-for-opportunity.ts` — extracted (behavior
// unchanged) so Epic 12's agents can call the exact same function instead
// of reimplementing it; see that file's header comment.
opportunityRecommendationsRoute.post(
  '/:id/recommendations/generate',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const org = c.get('org');
    const opportunityId = c.req.param('id');

    const result = await generateRecommendationForOpportunity(org.organizationId, opportunityId);
    if ('error' in result) return c.json(NOT_FOUND_ERROR, 404);

    await writeManualAuditEvent(c, { action: 'recommendation.generated', entityType: 'opportunity_recommendation', entityId: result.recommendation.id });

    return c.json({ created: result.created, recommendation: serializeRecommendation(result.recommendation) }, result.created ? 201 : 200);
  },
);

export default opportunityRecommendationsRoute;
