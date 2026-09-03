/**
 * Growth Agent — `docs/13-agents/AGENT_ARCHITECTURE.md`'s "Unified Growth
 * Agent... Combines all specialized agents." A thin orchestrator over the
 * two already-built agents this epic implements: it runs `GeoAgent` then
 * `SeoAgent` to completion, re-yielding every one of their events verbatim
 * (each sub-agent's own steps/evidence are real, not synthesized), then
 * adds one final synthesis event. It does not call any Epic 5/7/8/9/10
 * engine function directly itself — `GeoAgent`/`SeoAgent` are the
 * "already-built" pieces this agent orchestrates, exactly the same
 * "thin orchestrator calling already-built... functions" shape the other
 * two agents have, one level up.
 */
import type { Agent, AgentContext, AgentEvent, Action, AgentName, AutonomyLevel } from './types.js';
import { canPerformTool } from './tool-permissions.js';
import { GeoAgent } from './geo-agent.js';
import { SeoAgent } from './seo-agent.js';

export const GROWTH_AGENT_VERSION = '1.0.0';

export class GrowthAgent implements Agent {
  readonly name: AgentName = 'growth_agent';
  readonly version = GROWTH_AGENT_VERSION;

  constructor(readonly autonomyLevel: AutonomyLevel) {}

  canPerform(action: Action): boolean {
    return canPerformTool(this.name, action);
  }

  async *run(context: AgentContext): AsyncGenerator<AgentEvent> {
    const geoAgent = new GeoAgent(this.autonomyLevel);
    const seoAgent = new SeoAgent(this.autonomyLevel);

    let geoResultId: string | null = null;
    let geoRecommendationCount = 0;
    yield { type: 'progress', message: 'Running GEO Agent.', step: 1, totalSteps: 3, evidence: { phase: 'geo_agent' } };
    for await (const event of geoAgent.run(context)) {
      if (event.type === 'complete') geoResultId = event.resultId;
      if (event.type === 'recommendation') geoRecommendationCount += 1;
      if (event.type === 'error' && event.fatal) {
        // A fatal sub-agent error does not silently vanish — surfaced as a
        // non-fatal observation so the Growth Agent's own run can still
        // proceed to the SEO half (the two halves are independent signals;
        // GEO having no data yet, e.g. no completed AI run, should not
        // block SEO's opportunities from being computed).
        yield { type: 'observation', observation: `GEO Agent could not complete: ${event.message}`, evidence: { phase: 'geo_agent' } };
        continue;
      }
      yield event;
    }

    let seoResultId: string | null = null;
    let seoRecommendationCount = 0;
    yield { type: 'progress', message: 'Running SEO Agent.', step: 2, totalSteps: 3, evidence: { phase: 'seo_agent' } };
    for await (const event of seoAgent.run(context)) {
      if (event.type === 'complete') seoResultId = event.resultId;
      if (event.type === 'recommendation') seoRecommendationCount += 1;
      if (event.type === 'error' && event.fatal) {
        yield { type: 'observation', observation: `SEO Agent could not complete: ${event.message}`, evidence: { phase: 'seo_agent' } };
        continue;
      }
      yield event;
    }

    yield {
      type: 'progress',
      message: 'Synthesizing unified growth plan.',
      step: 3,
      totalSteps: 3,
      evidence: { geoResultId, seoResultId },
    };

    const totalRecommendations = geoRecommendationCount + seoRecommendationCount;
    yield {
      type: 'complete',
      summary: `Growth Agent run complete: ${totalRecommendations} recommendation(s) across GEO and SEO.`,
      resultId: geoResultId ?? seoResultId ?? context.brandId,
    };
  }
}
