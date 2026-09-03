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
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import {
  actionTypeForOpportunityType,
  computePriorityRank,
  descriptionForRecommendation,
  evidenceSummaryForRecommendation,
  implementationNotesForRecommendation,
  levelFromScore,
  titleForRecommendation,
  topCompetitorName,
} from '../lib/recommendations/generator.js';
import { serializeRecommendation } from '../lib/recommendations/serialize.js';
import type { AppEnv } from '../types/context.js';

const opportunityRecommendationsRoute = new Hono<AppEnv>();

const MUTATE = 'create_brand_profile' as const;
const NOT_FOUND_ERROR = { error: 'Opportunity not found' } as const;

opportunityRecommendationsRoute.post(
  '/:id/recommendations/generate',
  requireAuth,
  requireOrgFromToken('viewer'),
  requirePermission(MUTATE),
  async (c) => {
    const org = c.get('org');
    const opportunityId = c.req.param('id');

    // Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit
    // WHERE) as `opportunity-details.ts`'s `getOpportunity` — a foreign id
    // 404s, never a 403 that would confirm it exists (tenant isolation).
    const opportunity = await withOrgContext(org.organizationId, (tx) =>
      tx.unified_opportunities.findFirst({
        where: { id: opportunityId, organization_id: org.organizationId },
        include: { opportunity_evidence: { orderBy: { created_at: 'asc' } } },
      }),
    );
    if (!opportunity) return c.json(NOT_FOUND_ERROR, 404);

    const opportunityScore = Number(opportunity.opportunity_score);
    const effortScore = Number(opportunity.effort_score);
    const impactScore = Number(opportunity.impact_score);
    const actionType = actionTypeForOpportunityType(opportunity.type);
    const effort = levelFromScore(effortScore);
    const impact = levelFromScore(impactScore);
    const priorityRank = computePriorityRank(opportunityScore, effort);

    const evidence = opportunity.opportunity_evidence.map((e) => ({
      sourceTable: e.source_table,
      summary: e.summary,
      rawData: (e.raw_data as Record<string, unknown> | null) ?? null,
    }));
    const competitorName = topCompetitorName(evidence);
    const briefCtx = { actionType, intentText: opportunity.intent_text, brandName: 'Your brand', competitorName };

    // The real brand name reads better in the title/description than the
    // generic "Your brand" placeholder above — fetched only when needed
    // (a brand always exists here since an opportunity can only have been
    // created for one, but defended anyway rather than assumed).
    const brand = await withOrgContext(org.organizationId, (tx) => tx.brands.findFirst({ where: { id: opportunity.brand_id, organization_id: org.organizationId } }));
    briefCtx.brandName = brand?.name ?? briefCtx.brandName;

    const data = {
      organization_id: org.organizationId,
      brand_id: opportunity.brand_id,
      opportunity_id: opportunity.id,
      action_type: actionType,
      effort,
      impact,
      priority_rank: priorityRank,
      title: titleForRecommendation(briefCtx),
      description: descriptionForRecommendation(briefCtx),
      evidence_summary: evidenceSummaryForRecommendation(opportunityScore, opportunity.priority as 1 | 2 | 3, evidence),
      implementation_notes: implementationNotesForRecommendation(actionType, opportunity.intent_text, competitorName),
    };

    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.opportunity_recommendations.findFirst({ where: { organization_id: org.organizationId, opportunity_id: opportunity.id } }),
    );

    const row = existing
      ? await withOrgContext(org.organizationId, (tx) => tx.opportunity_recommendations.update({ where: { id: existing.id }, data: { ...data, updated_at: new Date() } }))
      : await withOrgContext(org.organizationId, (tx) => tx.opportunity_recommendations.create({ data }));

    await writeManualAuditEvent(c, { action: 'recommendation.generated', entityType: 'opportunity_recommendation', entityId: row.id });

    return c.json({ created: !existing, recommendation: serializeRecommendation(row) }, existing ? 200 : 201);
  },
);

export default opportunityRecommendationsRoute;
