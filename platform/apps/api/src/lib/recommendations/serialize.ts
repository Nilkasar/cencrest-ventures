/**
 * Response shape shared by `routes/opportunity-recommendations.ts` (generate),
 * `routes/recommendations.ts` (brand-scoped list), and
 * `routes/recommendation-details.ts` (id-addressed patch) — same "one place,
 * one shape" convention `lib/opportunities/serialize.ts` establishes for
 * Epic 9.
 */
import type { opportunity_recommendations } from '@bebest/database';

export function serializeRecommendation(row: opportunity_recommendations) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    brandId: row.brand_id,
    actionType: row.action_type,
    effort: row.effort,
    impact: row.impact,
    priorityRank: Number(row.priority_rank),
    title: row.title,
    description: row.description,
    evidenceSummary: row.evidence_summary,
    implementationNotes: row.implementation_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
