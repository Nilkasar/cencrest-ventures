import type { agent_events, agent_pending_actions, agent_runs } from '@bebest/database';

export function serializeAgentRun(row: agent_runs) {
  return {
    id: row.id,
    brandId: row.brand_id,
    agentName: row.agent_name,
    agentVersion: row.agent_version,
    status: row.status,
    triggeredBy: row.triggered_by,
    triggeredById: row.triggered_by_id,
    autonomyLevel: row.autonomy_level,
    stepsCompleted: row.steps_completed,
    totalSteps: row.total_steps,
    tokensUsed: row.tokens_used,
    latencyMs: row.latency_ms,
    resultId: row.result_id,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeAgentEvent(row: agent_events) {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    type: row.type,
    message: row.message,
    step: row.step,
    totalSteps: row.total_steps,
    evidence: row.evidence,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export function serializeAgentPendingAction(row: agent_pending_actions) {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    agentEventId: row.agent_event_id,
    actionType: row.action_type,
    title: row.title,
    description: row.description,
    payload: row.payload,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rollbackUntil: row.rollback_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
