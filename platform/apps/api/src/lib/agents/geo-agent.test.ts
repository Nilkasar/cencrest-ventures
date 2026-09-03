import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentContext } from './types.js';

// ── Mock @bebest/database down to what geo-agent.ts touches directly
// (the brand lookup) ─────────────────────────────────────────────────────
const db = { brands: { findFirst: vi.fn() } };
vi.mock('@bebest/database', () => ({ withOrgContext: vi.fn(async (_org: string, fn: (tx: unknown) => unknown) => fn(db)) }));

// ── Mock every engine-calling step so this test can assert EXACTLY what
// each one received and in what order — the epic's DoD: "confirm each
// yielded event corresponds to a REAL underlying call... in the correct
// order, not a synthetic/simulated step list." ───────────────────────────
const ensureActiveQuerySet = vi.fn();
vi.mock('./ensure-query-universe.js', () => ({ ensureActiveQuerySet: (...args: unknown[]) => ensureActiveQuerySet(...args) }));

const runAiVisibilityStep = vi.fn();
vi.mock('./run-ai-visibility-step.js', () => ({ runAiVisibilityStep: (...args: unknown[]) => runAiVisibilityStep(...args) }));

const diagnoseGapsStep = vi.fn();
vi.mock('./diagnose-gaps-step.js', () => ({ diagnoseGapsStep: (...args: unknown[]) => diagnoseGapsStep(...args) }));

const recomputeOpportunitiesForBrand = vi.fn();
vi.mock('../opportunities/recompute.js', () => ({ recomputeOpportunitiesForBrand: (...args: unknown[]) => recomputeOpportunitiesForBrand(...args) }));

const generateRecommendationForOpportunity = vi.fn();
vi.mock('../recommendations/generate-for-opportunity.js', () => ({
  generateRecommendationForOpportunity: (...args: unknown[]) => generateRecommendationForOpportunity(...args),
}));

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };
const QUERY_SET = { id: 'qs-1', name: 'Acme Query Universe' };
const OPPORTUNITY = { id: 'opp-1', opportunity_score: '80.00' };

const CONTEXT: AgentContext = {
  organizationId: 'org-1',
  brandId: 'brand-1',
  triggeredBy: 'user',
  triggeredById: 'user-1',
  parameters: {},
  autonomyLevel: 1,
  registry: {} as AgentContext['registry'],
  logger: console,
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.brands.findFirst.mockResolvedValue(BRAND);
  ensureActiveQuerySet.mockResolvedValue({ querySet: QUERY_SET, created: false });
  runAiVisibilityStep.mockResolvedValue({ aiRunId: 'run-1', aiVisibilityScore: 62.5 });
  diagnoseGapsStep.mockResolvedValue({
    findings: [
      {
        gapType: 'intent_gap',
        severity: 'high',
        queryId: 'q1',
        queryText: 'best crm software',
        yourMentionRatePct: 0,
        competitors: [{ competitorId: 'c1', competitorName: 'Rival', mentionRatePct: 80 }],
      },
    ],
  });
  recomputeOpportunitiesForBrand.mockResolvedValue({
    querySetId: 'qs-1',
    summary: { intentsConsidered: 1, created: 1, updated: 0, reactivated: 0, skippedDismissed: 0, skippedNoSignal: 0 },
    opportunities: [OPPORTUNITY],
  });
  generateRecommendationForOpportunity.mockResolvedValue({ created: true, recommendation: { id: 'rec-1', title: 'Build a comparison page' } });
});

describe('GeoAgent.run — thin-orchestrator call order (this epic\'s DoD)', () => {
  it('calls the real engines in the documented order: profile -> query universe -> AI visibility -> diagnose gaps -> recommend', async () => {
    const { GeoAgent } = await import('./geo-agent.js');
    const agent = new GeoAgent(1);

    const events = await collect(agent.run(CONTEXT));

    // Real underlying calls happened, with the real ids threaded through.
    expect(db.brands.findFirst).toHaveBeenCalled();
    expect(ensureActiveQuerySet).toHaveBeenCalledWith('org-1', 'brand-1', 'user-1');
    expect(runAiVisibilityStep).toHaveBeenCalledWith('org-1', 'brand-1', 'qs-1', 'user-1');
    expect(diagnoseGapsStep).toHaveBeenCalledWith('org-1', 'brand-1');
    expect(recomputeOpportunitiesForBrand).toHaveBeenCalledWith('org-1');
    expect(generateRecommendationForOpportunity).toHaveBeenCalledWith('org-1', 'opp-1');

    // Call ORDER, not just "all were called" — a mock call-order array is
    // the concrete proof, not an assumption from reading the source.
    const callOrder = [
      db.brands.findFirst.mock.invocationCallOrder[0],
      ensureActiveQuerySet.mock.invocationCallOrder[0],
      runAiVisibilityStep.mock.invocationCallOrder[0],
      diagnoseGapsStep.mock.invocationCallOrder[0],
      recomputeOpportunitiesForBrand.mock.invocationCallOrder[0],
      generateRecommendationForOpportunity.mock.invocationCallOrder[0],
    ];
    expect(callOrder).toEqual([...callOrder].sort((a, b) => (a ?? 0) - (b ?? 0)));

    // Every event corresponds to a real step, with real evidence ids — not
    // a synthetic/simulated step list.
    const types = events.map((e) => e.type);
    expect(types).toEqual(['progress', 'progress', 'progress', 'observation', 'progress', 'observation', 'progress', 'recommendation', 'complete']);

    const aiProgress = events.find((e) => e.type === 'progress' && e.step === 3);
    expect(aiProgress).toMatchObject({ evidence: { aiRunId: 'run-1' } });

    const recEvent = events.find((e) => e.type === 'recommendation');
    expect(recEvent).toMatchObject({ recommendation: { id: 'rec-1' }, evidence: { opportunityId: 'opp-1', recommendationId: 'rec-1' } });

    const complete = events.at(-1);
    expect(complete).toMatchObject({ type: 'complete', resultId: 'rec-1' });
  });

  it('stops with a fatal error and does NOT call downstream engines when the query universe cannot be resolved', async () => {
    ensureActiveQuerySet.mockResolvedValue({ error: 'no_human_trigger' });
    const { GeoAgent } = await import('./geo-agent.js');
    const agent = new GeoAgent(1);

    const events = await collect(agent.run(CONTEXT));

    expect(events.at(-1)).toMatchObject({ type: 'error', fatal: true });
    expect(runAiVisibilityStep).not.toHaveBeenCalled();
    expect(diagnoseGapsStep).not.toHaveBeenCalled();
    expect(recomputeOpportunitiesForBrand).not.toHaveBeenCalled();
  });

  it('never yields action_required at Level 1 or 2', async () => {
    const { GeoAgent } = await import('./geo-agent.js');

    for (const level of [1, 2] as const) {
      const events = await collect(new GeoAgent(level).run({ ...CONTEXT, autonomyLevel: level }));
      expect(events.some((e) => e.type === 'action_required')).toBe(false);
    }
  });

  it('yields exactly one action_required event at Level 3, naming the top recommendation, and never publishes/executes anything', async () => {
    const { GeoAgent } = await import('./geo-agent.js');
    const agent = new GeoAgent(3);

    const events = await collect(agent.run({ ...CONTEXT, autonomyLevel: 3 }));

    const actionEvents = events.filter((e) => e.type === 'action_required');
    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0]).toMatchObject({
      action: { actionType: 'create_content_brief', payload: { recommendationId: 'rec-1' } },
    });
    // This epic's own explicit requirement: confirm this build does NOT
    // publish anything. No `publish_content`-shaped call exists anywhere in
    // this module for the mock to even record — asserted here by construction:
    // canPerform for publish_content is false regardless of level.
    expect(agent.canPerform({ tool: 'publish_content' })).toBe(false);
  });
});
