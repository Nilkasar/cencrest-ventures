import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, AgentContext, AgentEvent } from './types.js';

async function* fakeRun(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

const geoEvents: AgentEvent[] = [
  { type: 'progress', message: 'geo step', step: 1, totalSteps: 1 },
  { type: 'recommendation', recommendation: { id: 'geo-rec', title: 'GEO rec' } },
  { type: 'complete', summary: 'geo done', resultId: 'geo-rec' },
];
const seoEvents: AgentEvent[] = [
  { type: 'progress', message: 'seo step', step: 1, totalSteps: 1 },
  { type: 'recommendation', recommendation: { id: 'seo-rec', title: 'SEO rec' } },
  { type: 'complete', summary: 'seo done', resultId: 'seo-rec' },
];

const geoRun = vi.fn();
const seoRun = vi.fn();

vi.mock('./geo-agent.js', () => ({
  GeoAgent: class {
    autonomyLevel: number;
    constructor(level: number) {
      this.autonomyLevel = level;
    }
    run(context: AgentContext) {
      geoRun(context);
      return fakeRun(geoEvents);
    }
  },
}));

vi.mock('./seo-agent.js', () => ({
  SeoAgent: class {
    autonomyLevel: number;
    constructor(level: number) {
      this.autonomyLevel = level;
    }
    run(context: AgentContext) {
      seoRun(context);
      return fakeRun(seoEvents);
    }
  },
}));

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

beforeEach(() => vi.clearAllMocks());

describe('GrowthAgent.run — composes GeoAgent then SeoAgent, re-yielding their real events', () => {
  it('runs GEO to completion before SEO starts, forwarding both agents\' own events verbatim', async () => {
    const { GrowthAgent } = await import('./growth-agent.js');
    const agent: Agent = new GrowthAgent(1);

    const events = await collect(agent.run(CONTEXT));

    expect(geoRun).toHaveBeenCalledWith(CONTEXT);
    expect(seoRun).toHaveBeenCalledWith(CONTEXT);
    expect(geoRun.mock.invocationCallOrder[0] ?? 0).toBeLessThan(seoRun.mock.invocationCallOrder[0] ?? 1);

    // Both sub-agents' recommendation events are forwarded, not dropped or
    // synthesized into a single fake one.
    const recommendationIds = events.filter((e) => e.type === 'recommendation').map((e) => e.recommendation.id);
    expect(recommendationIds).toEqual(['geo-rec', 'seo-rec']);

    const complete = events.at(-1);
    expect(complete).toMatchObject({ type: 'complete' });
    expect((complete as { summary: string }).summary).toContain('2 recommendation');
  });
});
