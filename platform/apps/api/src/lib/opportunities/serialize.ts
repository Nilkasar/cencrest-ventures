/**
 * Response shapes shared by `routes/opportunities.ts` (brand-scoped list +
 * recompute) and `routes/opportunity-details.ts` (id-addressed get/patch) —
 * same "one place, one shape" convention `lib/ai-visibility/serialize.ts`
 * establishes for Epic 7/8.
 */
import type { unified_opportunities, opportunity_evidence } from '@bebest/database';

export function serializeOpportunity(row: unified_opportunities) {
  return {
    id: row.id,
    queryId: row.query_id,
    intentText: row.intent_text,
    type: row.type,
    seoDemandScore: row.seo_demand_score === null ? null : Number(row.seo_demand_score),
    geoGapScore: row.geo_gap_score === null ? null : Number(row.geo_gap_score),
    effortScore: Number(row.effort_score),
    impactScore: Number(row.impact_score),
    opportunityScore: Number(row.opportunity_score),
    scoringFormulaVersion: row.scoring_formula_version,
    status: row.status,
    priority: row.priority,
    dismissalReason: row.dismissal_reason,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeEvidence(row: opportunity_evidence) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    summary: row.summary,
    rawData: row.raw_data,
    createdAt: row.created_at,
  };
}

/** `GET /opportunities/:id`'s shape — the evidence trail is inlined (the
 * epic's UI-surface requirement: "each opportunity's card must show its
 * evidence inline or one click away, never buried"), not a second request
 * a caller has to know to make. */
export function serializeOpportunityDetail(row: unified_opportunities & { opportunity_evidence: opportunity_evidence[] }) {
  return {
    ...serializeOpportunity(row),
    evidence: row.opportunity_evidence.map(serializeEvidence),
  };
}
