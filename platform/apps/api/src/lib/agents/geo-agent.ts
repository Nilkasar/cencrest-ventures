/**
 * GEO Agent — `docs/epics/12-agents.md`'s literal flow: "profile (read
 * Epic 2 brand) → generate query universe (Epic 5, if none active) → run AI
 * visibility (Epic 7) → diagnose gaps (Epic 8/9) → recommend (Epic 10) →
 * done." A THIN ORCHESTRATOR — every step below calls an already-built
 * engine function; nothing here recomputes a score, reclassifies a gap, or
 * reimplements the recommendation template. Every yielded event carries
 * real evidence (an id into the underlying engine's own data), never a
 * synthetic progress string.
 */
import { withOrgContext } from '@bebest/database';
import type { Agent, AgentContext, AgentEvent, Action, AgentName, AutonomyLevel } from './types.js';
import { canPerformTool } from './tool-permissions.js';
import { ensureActiveQuerySet } from './ensure-query-universe.js';
import { runAiVisibilityStep } from './run-ai-visibility-step.js';
import { diagnoseGapsStep } from './diagnose-gaps-step.js';
import { recomputeOpportunitiesForBrand } from '../opportunities/recompute.js';
import { generateRecommendationForOpportunity } from '../recommendations/generate-for-opportunity.js';

export const GEO_AGENT_VERSION = '1.0.0';
const TOTAL_STEPS = 5;
/** How many top-ranked opportunities get a generated recommendation per
 * run — a deliberate cap (this epic's brief: an agent step, not an
 * unbounded batch job), documented rather than an unexplained magic
 * number. */
const MAX_RECOMMENDATIONS_PER_RUN = 3;

export class GeoAgent implements Agent {
  readonly name: AgentName = 'geo_agent';
  readonly version = GEO_AGENT_VERSION;

  constructor(readonly autonomyLevel: AutonomyLevel) {}

  canPerform(action: Action): boolean {
    return canPerformTool(this.name, action);
  }

  async *run(context: AgentContext): AsyncGenerator<AgentEvent> {
    const { organizationId, brandId } = context;

    // ── 1. Profile (Epic 2) ────────────────────────────────────────────
    const brand = await withOrgContext(organizationId, (tx) =>
      tx.brands.findFirst({ where: { id: brandId, organization_id: organizationId, deleted_at: null } }),
    );
    if (!brand) {
      yield { type: 'error', message: 'Brand profile not found.', fatal: true };
      return;
    }
    yield {
      type: 'progress',
      message: `Loaded brand profile for "${brand.name}".`,
      step: 1,
      totalSteps: TOTAL_STEPS,
      evidence: { brandId: brand.id },
    };

    // ── 2. Query universe (Epic 5, if none active) ─────────────────────
    const querySetResult = await ensureActiveQuerySet(organizationId, brandId, context.triggeredById);
    if ('error' in querySetResult) {
      yield { type: 'error', message: `Could not resolve an active query universe (${querySetResult.error}).`, fatal: true };
      return;
    }
    yield {
      type: 'progress',
      message: querySetResult.created
        ? `Generated and activated a new query universe ("${querySetResult.querySet.name}").`
        : `Using the existing active query universe ("${querySetResult.querySet.name}").`,
      step: 2,
      totalSteps: TOTAL_STEPS,
      evidence: { querySetId: querySetResult.querySet.id },
    };

    // ── 3. AI visibility (Epic 7) ───────────────────────────────────────
    const aiVisibilityResult = await runAiVisibilityStep(organizationId, brandId, querySetResult.querySet.id, context.triggeredById);
    if ('error' in aiVisibilityResult) {
      const message =
        aiVisibilityResult.error === 'entitlement'
          ? aiVisibilityResult.message
          : `Could not run AI visibility measurement (${aiVisibilityResult.error}).`;
      yield { type: 'error', message, fatal: true };
      return;
    }
    yield {
      type: 'progress',
      message: 'Ran AI visibility measurement across all configured providers.',
      step: 3,
      totalSteps: TOTAL_STEPS,
      evidence: { aiRunId: aiVisibilityResult.aiRunId },
    };
    yield {
      type: 'observation',
      observation:
        aiVisibilityResult.aiVisibilityScore === null
          ? 'AI visibility score is not yet available for this run.'
          : `AI Visibility Score: ${aiVisibilityResult.aiVisibilityScore}.`,
      evidence: { aiRunId: aiVisibilityResult.aiRunId, aiVisibilityScore: aiVisibilityResult.aiVisibilityScore },
    };

    // ── 4. Diagnose gaps (Epic 8/9) ──────────────────────────────────────
    const gapsResult = await diagnoseGapsStep(organizationId, brandId);
    const findings = 'findings' in gapsResult ? gapsResult.findings : [];
    yield {
      type: 'progress',
      message:
        findings.length > 0
          ? `Diagnosed ${findings.length} competitive gap(s) requiring attention.`
          : 'Diagnosed competitive gaps: none found for this query universe.',
      step: 4,
      totalSteps: TOTAL_STEPS,
      evidence: { gapCount: findings.length },
    };
    // Tool outputs (gap findings quote query text and competitor names —
    // ultimately sourced from a query the user or the template generator
    // wrote, never from crawled/AI-response free text) are formatted here
    // as a plain, quoted DATA field in the observation string — never
    // string-concatenated as if they were instructions to this agent or to
    // any downstream AI call. This step makes no AI provider call at all.
    for (const finding of findings) {
      const topCompetitor = finding.competitors[0];
      yield {
        type: 'observation',
        observation: `Competitive gap for "${finding.queryText}": ${topCompetitor?.competitorName ?? 'a competitor'} appears in ${topCompetitor?.mentionRatePct ?? 0}% of responses, you appear in ${finding.yourMentionRatePct}%.`,
        evidence: { queryId: finding.queryId, severity: finding.severity, competitors: finding.competitors },
      };
    }

    // ── 5. Recommend (Epic 9 recompute + Epic 10 generate) ──────────────
    const recomputeResult = await recomputeOpportunitiesForBrand(organizationId);
    if ('error' in recomputeResult) {
      yield { type: 'error', message: `Could not recompute opportunities (${recomputeResult.error}).`, fatal: true };
      return;
    }
    yield {
      type: 'progress',
      message: `Recomputed opportunities: ${recomputeResult.summary.created} created, ${recomputeResult.summary.updated} updated, ${recomputeResult.summary.reactivated} reactivated.`,
      step: 5,
      totalSteps: TOTAL_STEPS,
      evidence: { querySetId: recomputeResult.querySetId, summary: recomputeResult.summary },
    };

    const topOpportunities = [...recomputeResult.opportunities]
      .sort((a, b) => Number(b.opportunity_score) - Number(a.opportunity_score))
      .slice(0, MAX_RECOMMENDATIONS_PER_RUN);

    let topRecommendationId: string | null = null;
    let topRecommendationTitle: string | null = null;
    for (const opportunity of topOpportunities) {
      const recResult = await generateRecommendationForOpportunity(organizationId, opportunity.id);
      if ('error' in recResult) continue;
      if (topRecommendationId === null) {
        topRecommendationId = recResult.recommendation.id;
        topRecommendationTitle = recResult.recommendation.title;
      }
      yield {
        type: 'recommendation',
        recommendation: { id: recResult.recommendation.id, title: recResult.recommendation.title },
        evidence: { opportunityId: opportunity.id, recommendationId: recResult.recommendation.id },
      };
    }

    // ── Level 3 — Approve & Execute: one pending action, the top
    // recommendation, presented for one-click approval. Never reached at
    // Level 1/2 — see `canPerform`/`tool-permissions.ts` for the same
    // allowlist this gate mirrors. Execution itself never happens in this
    // epic (Epic 13's job) — this only ever produces an `action_required`
    // event for the runner to persist as a pending approval.
    if (this.autonomyLevel >= 3 && topRecommendationId !== null && this.canPerform({ tool: 'create_content_brief' })) {
      yield {
        type: 'action_required',
        action: {
          actionType: 'create_content_brief',
          title: `Approve content brief for: ${topRecommendationTitle ?? 'top recommendation'}`,
          description: 'Approving this creates a content brief from the top-priority recommendation this run produced, ready for Epic 13 to execute.',
          payload: { recommendationId: topRecommendationId },
        },
        evidence: { recommendationId: topRecommendationId },
      };
    }

    const resultId = topRecommendationId ?? topOpportunities[0]?.id ?? aiVisibilityResult.aiRunId;
    yield {
      type: 'complete',
      summary: `GEO Agent run complete: ${findings.length} gap(s) diagnosed, ${topOpportunities.length} recommendation(s) generated.`,
      resultId,
    };
  }
}
