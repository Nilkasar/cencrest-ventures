/**
 * Epic 12 — the Agent Runner: `docs/13-agents/AGENT_ARCHITECTURE.md`'s
 * 10-step lifecycle ("receive trigger... check permissions... create agent
 * run record... execute agent... store all events in database... on
 * completion, create result record"), condensed to what this build actually
 * needs (no email/notification infra to wire step 9 into yet — same
 * documented gap every other epic's background job has).
 *
 * This is the ONLY place that:
 * - checks the `agent_runs_per_month` entitlement (Epic 16's real
 *   `checkUsageLimit`) BEFORE a run starts;
 * - resolves the run's actual autonomy level via `autonomy.ts`'s hard-block
 *   (never trusting a caller-supplied level directly);
 * - constructs a concrete `Agent` (via `registry.ts`) and drives its
 *   `run()` generator to completion, persisting every yielded event as its
 *   own row (the append-only transparency this epic's spec calls a "trust
 *   differentiator") and creating a Level-3 `agent_pending_actions` row for
 *   every `action_required` event.
 *
 * Mirrors `routes/crawl.ts`/`routes/ai-runs.ts`'s PREPARE-then-`setImmediate`
 * shape: `triggerAgentRun` creates the `agent_runs` row synchronously (so a
 * caller can poll `GET /agent-runs/:id` immediately) and schedules the
 * actual execution in the background — same documented "TODO: durable
 * queue (pg-boss)" placeholder every other background job in this codebase
 * uses, not a new pattern invented for this epic.
 */
import { withOrgContext, type agent_runs, type Prisma } from '@bebest/database';
import { checkUsageLimit, resolvePlanLimits } from '../entitlements.js';
import { getDefaultAiProviderRegistry } from '../ai-visibility/provider-registry.js';
import { countAgentRunsThisMonth } from './usage.js';
import { resolveRequestedAutonomyLevel } from './autonomy.js';
import { createAgent } from './registry.js';
import { GEO_AGENT_VERSION } from './geo-agent.js';
import { SEO_AGENT_VERSION } from './seo-agent.js';
import { GROWTH_AGENT_VERSION } from './growth-agent.js';
import type { AgentContext, AgentEvent, AgentName, AutonomyLevel, TriggeredBy } from './types.js';

const AGENT_VERSIONS: Record<AgentName, string> = {
  geo_agent: GEO_AGENT_VERSION,
  seo_agent: SEO_AGENT_VERSION,
  growth_agent: GROWTH_AGENT_VERSION,
};

export interface TriggerAgentRunParams {
  organizationId: string;
  brandId: string;
  agentName: AgentName;
  triggeredBy: TriggeredBy;
  triggeredById?: string;
  /** Unvalidated — funneled through `resolveRequestedAutonomyLevel` before
   * ANYTHING else touches it. See `autonomy.ts`'s header comment. */
  requestedAutonomyLevel?: unknown;
  parameters?: Record<string, unknown>;
}

export type TriggerAgentRunResult = { error: 'agents_not_available' } | { run: agent_runs };

/**
 * PREPARE + QUEUE. Entitlement-checks (`agents` feature flag, then
 * `agent_runs_per_month`) and resolves the autonomy level BEFORE the
 * `agent_runs` row is created — same "check everything before the first
 * write" discipline `routes/ai-runs.ts` uses for `ai_queries_per_month`.
 * `EntitlementLimitError` (from `checkUsageLimit`) and
 * `AutonomyLevelRejectedError` (from `resolveRequestedAutonomyLevel`) both
 * propagate to the caller — this function does not catch either, matching
 * the "throws a typed error, route decides the HTTP status" convention
 * every other entitlement-checked route uses.
 */
export async function triggerAgentRun(params: TriggerAgentRunParams): Promise<TriggerAgentRunResult> {
  const { limits } = await resolvePlanLimits(params.organizationId);
  if (!limits.agents) return { error: 'agents_not_available' };

  await checkUsageLimit(params.organizationId, 'agent_runs_per_month', () => countAgentRunsThisMonth(params.organizationId), 1);

  const autonomyLevel = resolveRequestedAutonomyLevel(params.requestedAutonomyLevel, limits.autonomy_level_max);

  if (params.triggeredBy === 'user' && !params.triggeredById) {
    throw new Error('triggeredById is required when triggeredBy is "user".');
  }

  const run = await withOrgContext(params.organizationId, (tx) =>
    tx.agent_runs.create({
      data: {
        organization_id: params.organizationId,
        brand_id: params.brandId,
        agent_name: params.agentName,
        agent_version: AGENT_VERSIONS[params.agentName],
        status: 'queued',
        triggered_by: params.triggeredBy,
        triggered_by_id: params.triggeredById ?? null,
        autonomy_level: autonomyLevel,
        total_steps: 0,
      },
    }),
  );

  scheduleAgentRun(run.id, params, autonomyLevel);

  return { run };
}

function scheduleAgentRun(runId: string, params: TriggerAgentRunParams, autonomyLevel: AutonomyLevel): void {
  setImmediate(() => {
    void executeAgentRun(runId, params, autonomyLevel).catch(async (err) => {
      await withOrgContext(params.organizationId, (tx) =>
        tx.agent_runs.update({
          where: { id: runId },
          data: { status: 'failed', error: String((err as Error)?.message ?? err), completed_at: new Date() },
        }),
      ).catch(() => {
        // Best-effort — same convention as crawl.ts/schedule-run.ts.
      });
    });
  });
}

function decomposeEvent(event: AgentEvent): {
  message: string;
  step: number | null;
  totalSteps: number | null;
  evidence: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
} {
  switch (event.type) {
    case 'progress':
      return { message: event.message, step: event.step, totalSteps: event.totalSteps, evidence: event.evidence ?? null, payload: null };
    case 'observation':
      return { message: event.observation, step: null, totalSteps: null, evidence: event.evidence ?? null, payload: null };
    case 'recommendation':
      return { message: `Recommendation: ${event.recommendation.title}`, step: null, totalSteps: null, evidence: event.evidence ?? null, payload: event.recommendation };
    case 'draft':
      return { message: `Draft: ${event.content.title}`, step: null, totalSteps: null, evidence: event.evidence ?? null, payload: event.content };
    case 'action_required':
      return { message: event.action.title, step: null, totalSteps: null, evidence: event.evidence ?? null, payload: event.action };
    case 'complete':
      return { message: event.summary, step: null, totalSteps: null, evidence: null, payload: { resultId: event.resultId } };
    case 'error':
      return { message: event.message, step: null, totalSteps: null, evidence: null, payload: { fatal: event.fatal } };
  }
}

async function persistEvent(organizationId: string, brandId: string, runId: string, event: AgentEvent) {
  const decomposed = decomposeEvent(event);
  return withOrgContext(organizationId, (tx) =>
    tx.agent_events.create({
      data: {
        organization_id: organizationId,
        brand_id: brandId,
        agent_run_id: runId,
        type: event.type,
        message: decomposed.message,
        step: decomposed.step,
        total_steps: decomposed.totalSteps,
        evidence: (decomposed.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        payload: (decomposed.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    }),
  );
}

/**
 * EXECUTE + AGGREGATE. Drives the concrete `Agent`'s generator to
 * completion, persisting every event and updating `agent_runs`' own
 * bookkeeping fields as it goes (so `GET /agent-runs/:id` reflects live
 * progress via polling, the same pattern `ai_runs`/`crawl_jobs` already use
 * — no websocket/SSE infra exists elsewhere in this codebase to build a
 * true push-stream on top of).
 */
async function executeAgentRun(runId: string, params: TriggerAgentRunParams, autonomyLevel: AutonomyLevel): Promise<void> {
  const { organizationId, brandId, agentName } = params;
  const startedAtMs = Date.now();

  await withOrgContext(organizationId, (tx) =>
    tx.agent_runs.update({ where: { id: runId }, data: { status: 'running', started_at: new Date() } }),
  );

  const agent = createAgent(agentName, autonomyLevel);
  const context: AgentContext = {
    organizationId,
    brandId,
    triggeredBy: params.triggeredBy,
    triggeredById: params.triggeredById,
    parameters: params.parameters ?? {},
    autonomyLevel,
    registry: getDefaultAiProviderRegistry(),
    logger: console,
  };

  let finalStatus: 'completed' | 'failed' = 'completed';
  let finalError: string | null = null;
  let resultId: string | null = null;

  for await (const event of agent.run(context)) {
    const eventRow = await persistEvent(organizationId, brandId, runId, event);

    if (event.type === 'progress') {
      await withOrgContext(organizationId, (tx) =>
        tx.agent_runs.update({ where: { id: runId }, data: { steps_completed: event.step, total_steps: event.totalSteps } }),
      );
    }

    if (event.type === 'action_required') {
      // Level 3 mechanics — defense in depth: even though every concrete
      // agent already gates yielding this event type on
      // `this.autonomyLevel >= 3`, the runner independently refuses to
      // create the pending-approval row for anything below Level 3, so a
      // future agent implementation bug could never make a Level 1/2 run
      // produce a real, approvable action.
      if (autonomyLevel >= 3) {
        await withOrgContext(organizationId, (tx) =>
          tx.agent_pending_actions.create({
            data: {
              organization_id: organizationId,
              brand_id: brandId,
              agent_run_id: runId,
              agent_event_id: eventRow.id,
              action_type: event.action.actionType,
              title: event.action.title,
              description: event.action.description,
              payload: event.action.payload as Prisma.InputJsonValue,
              status: 'pending',
            },
          }),
        );
      }
    }

    if (event.type === 'complete') resultId = event.resultId;
    if (event.type === 'error' && event.fatal) {
      finalStatus = 'failed';
      finalError = event.message;
    }
  }

  await withOrgContext(organizationId, (tx) =>
    tx.agent_runs.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        error: finalError,
        result_id: resultId,
        completed_at: new Date(),
        latency_ms: Date.now() - startedAtMs,
      },
    }),
  );
}
