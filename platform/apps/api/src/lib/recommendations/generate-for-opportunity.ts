/**
 * Epic 10 (Recommendation Engine) — the `POST /opportunities/:id/
 * recommendations/generate` write logic, extracted out of
 * `routes/opportunity-recommendations.ts` into one reusable function
 * (behavior UNCHANGED — a pure code move, not a rewrite) so Epic 12's
 * GEO/SEO/Growth agents can call the exact same, already-tested idempotent
 * brief-generation logic instead of re-implementing any part of it — this
 * epic's own "thin orchestrator... do not reimplement any of their logic"
 * requirement. `routes/opportunity-recommendations.ts` now calls this same
 * function; nothing about its HTTP contract changed.
 */
import { withOrgContext, type opportunity_recommendations } from '@bebest/database';
import {
  actionTypeForOpportunityType,
  computePriorityRank,
  descriptionForRecommendation,
  evidenceSummaryForRecommendation,
  implementationNotesForRecommendation,
  levelFromScore,
  titleForRecommendation,
  topCompetitorName,
} from './generator.js';

export type GenerateRecommendationResult =
  | { error: 'not_found' }
  | { created: boolean; recommendation: opportunity_recommendations };

export async function generateRecommendationForOpportunity(
  organizationId: string,
  opportunityId: string,
): Promise<GenerateRecommendationResult> {
  const opportunity = await withOrgContext(organizationId, (tx) =>
    tx.unified_opportunities.findFirst({
      where: { id: opportunityId, organization_id: organizationId },
      include: { opportunity_evidence: { orderBy: { created_at: 'asc' } } },
    }),
  );
  if (!opportunity) return { error: 'not_found' };

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

  const brand = await withOrgContext(organizationId, (tx) =>
    tx.brands.findFirst({ where: { id: opportunity.brand_id, organization_id: organizationId } }),
  );
  briefCtx.brandName = brand?.name ?? briefCtx.brandName;

  const data = {
    organization_id: organizationId,
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

  const existing = await withOrgContext(organizationId, (tx) =>
    tx.opportunity_recommendations.findFirst({ where: { organization_id: organizationId, opportunity_id: opportunity.id } }),
  );

  const row = existing
    ? await withOrgContext(organizationId, (tx) => tx.opportunity_recommendations.update({ where: { id: existing.id }, data: { ...data, updated_at: new Date() } }))
    : await withOrgContext(organizationId, (tx) => tx.opportunity_recommendations.create({ data }));

  return { created: !existing, recommendation: row };
}
