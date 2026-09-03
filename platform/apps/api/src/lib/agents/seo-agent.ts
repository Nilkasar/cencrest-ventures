/**
 * SEO Agent — same "thin orchestrator" discipline as `geo-agent.ts`, over
 * `docs/13-agents/AGENT_ARCHITECTURE.md`'s SEO Agent responsibilities that
 * this platform has already-built engines for: read the brand's crawled
 * pages/issues (Epic 3, read-only — see `read-page-issues-step.ts`'s header
 * comment for why no new crawl is triggered here), ensure a query universe
 * exists (Epic 5), recompute opportunities (Epic 9 — naturally SEO-only
 * when no GEO run exists yet for this brand) and generate recommendations
 * (Epic 10). Nothing here re-implements the crawler, the keyword/opportunity
 * scoring formulas, or the recommendation templates.
 */
import { withOrgContext } from '@bebest/database';
import type { Agent, AgentContext, AgentEvent, Action, AgentName, AutonomyLevel } from './types.js';
import { canPerformTool } from './tool-permissions.js';
import { ensureActiveQuerySet } from './ensure-query-universe.js';
import { readPageIssuesStep } from './read-page-issues-step.js';
import { recomputeOpportunitiesForBrand } from '../opportunities/recompute.js';
import { generateRecommendationForOpportunity } from '../recommendations/generate-for-opportunity.js';

export const SEO_AGENT_VERSION = '1.0.0';
const TOTAL_STEPS = 4;
const MAX_RECOMMENDATIONS_PER_RUN = 3;

export class SeoAgent implements Agent {
  readonly name: AgentName = 'seo_agent';
  readonly version = SEO_AGENT_VERSION;

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

    // ── 2. Technical/content issues (Epic 3, read-only) ─────────────────
    const pageIssues = await readPageIssuesStep(organizationId, brandId);
    yield {
      type: 'progress',
      message:
        pageIssues.length > 0
          ? `Reviewed crawl data: ${pageIssues.length} page issue(s) found.`
          : 'Reviewed crawl data: no crawled pages/issues found yet for this brand.',
      step: 2,
      totalSteps: TOTAL_STEPS,
      evidence: { issueCount: pageIssues.length },
    };
    // Each `detail`/page title below is placed in a quoted DATA field, not
    // executed or treated as an instruction — see
    // `read-page-issues-step.ts`'s header comment (this epic's required
    // prompt-injection-resistance property).
    for (const issue of pageIssues) {
      yield {
        type: 'observation',
        observation: `${issue.severity} severity ${issue.issueType} issue on ${issue.pageUrl}${issue.detail ? `: "${issue.detail}"` : ''}`,
        evidence: { pageIssueId: issue.pageIssueId, pageId: issue.pageId, pageTitle: issue.pageTitle },
      };
    }

    // ── 3. Query universe (Epic 5, if none active) — shared with GEO
    // Agent's own step; Epic 9's recompute needs one regardless of which
    // signal (SEO/GEO) ends up present for a given intent. ───────────────
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
      step: 3,
      totalSteps: TOTAL_STEPS,
      evidence: { querySetId: querySetResult.querySet.id },
    };

    // ── 4. Recommend (Epic 9 recompute + Epic 10 generate) ──────────────
    const recomputeResult = await recomputeOpportunitiesForBrand(organizationId);
    if ('error' in recomputeResult) {
      yield { type: 'error', message: `Could not recompute opportunities (${recomputeResult.error}).`, fatal: true };
      return;
    }
    yield {
      type: 'progress',
      message: `Recomputed opportunities: ${recomputeResult.summary.created} created, ${recomputeResult.summary.updated} updated, ${recomputeResult.summary.reactivated} reactivated.`,
      step: 4,
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

    const resultId = topRecommendationId ?? topOpportunities[0]?.id ?? querySetResult.querySet.id;
    yield {
      type: 'complete',
      summary: `SEO Agent run complete: ${pageIssues.length} page issue(s) reviewed, ${topOpportunities.length} recommendation(s) generated.`,
      resultId,
    };
  }
}
