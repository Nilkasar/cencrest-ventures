/**
 * Response shapes for Epic 11's routes — same "one place, one shape"
 * convention `lib/recommendations/serialize.ts` establishes for Epic 10.
 */
import type { content_briefs, content_drafts, content_quality_checks, content_approvals } from '@bebest/database';

export function serializeBrief(row: content_briefs) {
  return {
    id: row.id,
    brandId: row.brand_id,
    recommendationId: row.recommendation_id,
    pageId: row.page_id,
    contentType: row.content_type,
    title: row.title,
    targetQuery: row.target_query,
    targetStage: row.target_stage,
    targetIntent: row.target_intent,
    keywords: row.keywords,
    outline: row.outline,
    evidenceSummary: row.evidence_summary,
    implementationNotes: row.implementation_notes,
    researchNotes: row.research_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeDraft(row: content_drafts) {
  return {
    id: row.id,
    briefId: row.brief_id,
    brandId: row.brand_id,
    version: row.version,
    providerName: row.provider_name,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    title: row.title,
    metaDescription: row.meta_description,
    body: row.body,
    wordCount: row.word_count,
    structuredDataTypes: row.structured_data_types,
    status: row.status,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeQualityCheck(row: content_quality_checks) {
  return {
    id: row.id,
    draftId: row.draft_id,
    checkType: row.check_type,
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    details: row.details,
    createdAt: row.created_at,
  };
}

export function serializeApproval(row: content_approvals) {
  return {
    id: row.id,
    draftId: row.draft_id,
    approvedBy: row.approved_by,
    approvedRole: row.approved_role,
    notes: row.notes,
    approvedAt: row.approved_at,
  };
}
