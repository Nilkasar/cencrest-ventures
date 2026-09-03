import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent } from './types.js';

const db = {
  agent_runs: { create: vi.fn(), update: vi.fn() },
  agent_events: { create: vi.fn() },
  agent_pending_actions: { create: vi.fn() },
};
vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_org: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

const resolvePlanLimits = vi.fn();
const checkUsageLimit = vi.fn();
class FakeEntitlementLimitError extends Error {
  constructor(
    public metric: string,
    public limit: number,
    public current: number,
    public plan: string,
    public upgradeTo: string | null,
  ) {
    super('limit reached');
  }
}
vi.mock('../entitlements.js', () => ({
  resolvePlanLimits: (...args: unknown[]) => resolvePlanLimits(...args),
  checkUsageLimit: (...args: unknown[]) => checkUsageLimit(...args),
  EntitlementLimitError: FakeEntitlementLimitError,
}));

const countAgentRunsThisMonth = vi.fn();
vi.mock('./usage.js', () => ({ countAgentRunsThisMonth: (...args: unknown[]) => countAgentRunsThisMonth(...args) }));

const getDefaultAiProviderRegistry = vi.fn(() => ({}));
vi.mock('../ai-visibility/provider-registry.js', () => ({ getDefaultAiProviderRegistry: () => getDefaultAiProviderRegistry() }));

vi.mock('./geo-agent.js', () => ({ GEO_AGENT_VERSION: '1.0.0' }));
vi.mock('./seo-agent.js', () => ({ SEO_AGENT_VERSION: '1.0.0' }));
vi.mock('./growth-agent.js', () => ({ GROWTH_AGENT_VERSION: '1.0.0' }));

async function* fakeAgentRun(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}
const createAgent = vi.fn();
vi.mock('./registry.js', () => ({ createAgent: (...args: unknown[]) => createAgent(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  resolvePlanLimits.mockResolvedValue({ plan: 'growth', limits: { agents: true, agent_runs_per_month: 10, autonomy_level_max: null } });
  checkUsageLimit.mockResolvedValue(undefined);
  countAgentRunsThisMonth.mockResolvedValue(0);
  db.agent_runs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run-1', ...data }));
  db.agent_runs.update.mockResolvedValue({});
  db.agent_events.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `event-${Math.random()}`, ...data }));
  db.agent_pending_actions.create.mockResolvedValue({});
  createAgent.mockReturnValue({ run: () => fakeAgentRun([{ type: 'complete', summary: 'done', resultId: 'res-1' }]) });
});

// Every `triggerAgentRun` call schedules its actual execution via
// `setImmediate` (mirrors `routes/crawl.ts`/`routes/ai-runs.ts`) — drain it
// after EVERY test, even ones not asserting on background behavior, so a
// scheduled callback from one test can never fire during (and pollute the
// mock call counts of) the next one.
afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
});

const BASE_PARAMS = {
  organizationId: 'org-1',
  brandId: 'brand-1',
  agentName: 'geo_agent' as const,
  triggeredBy: 'user' as const,
  triggeredById: 'user-1',
};

describe('triggerAgentRun — entitlement and autonomy checks BEFORE the run starts', () => {
  it('checks the agents feature flag first — returns agents_not_available and creates NO row when the plan lacks it', async () => {
    resolvePlanLimits.mockResolvedValue({ plan: 'free', limits: { agents: false, agent_runs_per_month: null, autonomy_level_max: null } });
    const { triggerAgentRun } = await import('./runner.js');

    const result = await triggerAgentRun(BASE_PARAMS);

    expect(result).toEqual({ error: 'agents_not_available' });
    expect(checkUsageLimit).not.toHaveBeenCalled();
    expect(db.agent_runs.create).not.toHaveBeenCalled();
  });

  it('calls Epic 16\'s real checkUsageLimit(\'agent_runs_per_month\') BEFORE creating the agent_runs row', async () => {
    const { triggerAgentRun } = await import('./runner.js');
    const callOrder: string[] = [];
    checkUsageLimit.mockImplementation(async () => {
      callOrder.push('checkUsageLimit');
    });
    db.agent_runs.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push('agent_runs.create');
      return { id: 'run-1', ...data };
    });

    await triggerAgentRun(BASE_PARAMS);

    expect(checkUsageLimit).toHaveBeenCalledWith('org-1', 'agent_runs_per_month', expect.any(Function), 1);
    expect(callOrder).toEqual(['checkUsageLimit', 'agent_runs.create']);
  });

  it('propagates EntitlementLimitError from checkUsageLimit without creating a row (same typed-error pattern as every other entitlement check)', async () => {
    checkUsageLimit.mockRejectedValue(new FakeEntitlementLimitError('agent_runs_per_month', 10, 10, 'growth', 'pro'));
    const { triggerAgentRun } = await import('./runner.js');

    await expect(triggerAgentRun(BASE_PARAMS)).rejects.toBeInstanceOf(FakeEntitlementLimitError);
    expect(db.agent_runs.create).not.toHaveBeenCalled();
  });

  it('rejects a request for autonomy level 4, at the runner level, with no row created — regardless of the plan\'s own autonomy_level_max', async () => {
    resolvePlanLimits.mockResolvedValue({ plan: 'agency', limits: { agents: true, agent_runs_per_month: null, autonomy_level_max: 99 } });
    const { triggerAgentRun } = await import('./runner.js');
    const { AutonomyLevelRejectedError } = await import('./autonomy.js');

    await expect(triggerAgentRun({ ...BASE_PARAMS, requestedAutonomyLevel: 4 })).rejects.toBeInstanceOf(AutonomyLevelRejectedError);
    expect(db.agent_runs.create).not.toHaveBeenCalled();
  });

  it('creates the agent_runs row with the resolved autonomy level and status "queued"', async () => {
    const { triggerAgentRun } = await import('./runner.js');

    const result = await triggerAgentRun({ ...BASE_PARAMS, requestedAutonomyLevel: 2 });

    expect('run' in result).toBe(true);
    expect(db.agent_runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          brand_id: 'brand-1',
          agent_name: 'geo_agent',
          status: 'queued',
          triggered_by: 'user',
          triggered_by_id: 'user-1',
          autonomy_level: 2,
        }),
      }),
    );
  });

  it('throws when triggeredBy is "user" with no triggeredById — never silently proceeds with an unattributed run', async () => {
    const { triggerAgentRun } = await import('./runner.js');
    await expect(triggerAgentRun({ ...BASE_PARAMS, triggeredById: undefined })).rejects.toThrow();
  });
});

describe('the scheduled background run — event persistence and Level 3 pending actions', () => {
  it('persists every yielded event and marks the run completed with the real resultId', async () => {
    createAgent.mockReturnValue({
      run: () =>
        fakeAgentRun([
          { type: 'progress', message: 'step 1', step: 1, totalSteps: 2 },
          { type: 'observation', observation: 'found something', evidence: { x: 1 } },
          { type: 'complete', summary: 'all done', resultId: 'rec-99' },
        ]),
    });
    const { triggerAgentRun } = await import('./runner.js');

    await triggerAgentRun(BASE_PARAMS);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.agent_events.create).toHaveBeenCalledTimes(3);
    expect(db.agent_events.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'progress', step: 1, total_steps: 2 }) }));
    expect(db.agent_events.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'observation', message: 'found something' }) }));

    const finalUpdate = db.agent_runs.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(finalUpdate.data).toMatchObject({ status: 'completed', result_id: 'rec-99' });
  });

  it('marks the run failed when a fatal error event is yielded', async () => {
    createAgent.mockReturnValue({ run: () => fakeAgentRun([{ type: 'error', message: 'boom', fatal: true }]) });
    const { triggerAgentRun } = await import('./runner.js');

    await triggerAgentRun(BASE_PARAMS);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const finalUpdate = db.agent_runs.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(finalUpdate.data).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('creates NO agent_pending_actions row for an action_required event at Level 1 — Level 3 mechanics only', async () => {
    createAgent.mockReturnValue({
      run: () =>
        fakeAgentRun([
          { type: 'action_required', action: { actionType: 'create_content_brief', title: 't', description: 'd', payload: {} } },
          { type: 'complete', summary: 'done', resultId: 'r1' },
        ]),
    });
    const { triggerAgentRun } = await import('./runner.js');

    await triggerAgentRun({ ...BASE_PARAMS, requestedAutonomyLevel: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.agent_pending_actions.create).not.toHaveBeenCalled();
  });

  it('creates a pending agent_pending_actions row for an action_required event at Level 3', async () => {
    createAgent.mockReturnValue({
      run: () =>
        fakeAgentRun([
          { type: 'action_required', action: { actionType: 'create_content_brief', title: 'Approve X', description: 'd', payload: { recommendationId: 'rec-1' } } },
          { type: 'complete', summary: 'done', resultId: 'rec-1' },
        ]),
    });
    const { triggerAgentRun } = await import('./runner.js');

    await triggerAgentRun({ ...BASE_PARAMS, requestedAutonomyLevel: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.agent_pending_actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action_type: 'create_content_brief', title: 'Approve X', status: 'pending' }),
      }),
    );
  });
});
