/**
 * Response shapes for Epic 13's routes — same "one place, one shape"
 * convention `lib/content/serialize.ts` (Epic 11) / `lib/agents/serialize.ts`
 * (Epic 12) already establish.
 */
import type { actions, published_content } from '@bebest/database';

export function serializeAction(row: actions) {
  return {
    id: row.id,
    brandId: row.brand_id,
    recommendationId: row.recommendation_id,
    actionType: row.action_type,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    autonomyLevel: row.autonomy_level,
    contentDraftId: row.content_draft_id,
    agentPendingActionId: row.agent_pending_action_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    rolledBackAt: row.rolled_back_at,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializePublishedContent(row: published_content) {
  return {
    id: row.id,
    brandId: row.brand_id,
    actionId: row.action_id,
    publishTarget: row.publish_target,
    destinationRef: row.destination_ref,
    title: row.title,
    body: row.body,
    status: row.status,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    rolledBackAt: row.rolled_back_at,
    rolledBackBy: row.rolled_back_by,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
