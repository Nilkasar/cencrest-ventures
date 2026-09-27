import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
const withOrgContext = vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn({ ai_usage: { create } }));

vi.mock('@bebest/database', () => ({
  withOrgContext: (...args: unknown[]) => withOrgContext(...(args as [string, (tx: unknown) => unknown])),
}));

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const INTERNAL_ORG = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'row-1' });
  process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRM_INTERNAL_ORG_ID;
});

describe('recordAiUsage', () => {
  it('writes the row inside the caller org\'s RLS context, with the right organization_id', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'ai_visibility_run' },
      providerName: 'openai',
      model: 'gpt-4o-2024-11-20',
      tokensIn: 1000,
      tokensOut: 500,
      latencyMs: 1234,
      finishReason: 'stop',
    });

    // RLS: the write must run with `app.current_org` set to the owning org —
    // `withOrgContext` is the ONLY mechanism that does that.
    expect(withOrgContext).toHaveBeenCalledTimes(1);
    expect(withOrgContext.mock.calls[0]![0]).toBe(ORG_A);
    expect(create).toHaveBeenCalledWith({
      data: {
        organization_id: ORG_A,
        provider_name: 'openai',
        model: 'gpt-4o-2024-11-20',
        tokens_in: 1000,
        tokens_out: 500,
        cost_usd: '0.007500',
        latency_ms: 1234,
        finish_reason: 'stop',
      },
    });
  });

  it('never writes another tenant\'s id: the row org and the context org are the same value', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_B, feature: 'agent:geo' },
      providerName: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokensIn: 10,
      tokensOut: 10,
    });

    const contextOrg = withOrgContext.mock.calls[0]![0];
    const rowOrg = (create.mock.calls[0]![0] as { data: { organization_id: string } }).data.organization_id;
    expect(contextOrg).toBe(ORG_B);
    expect(rowOrg).toBe(ORG_B);
    expect(rowOrg).not.toBe(ORG_A);
  });

  it('passes cost as a fixed-6dp STRING, never a JS number (no float round trip into Decimal(10,6))', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'f' },
      providerName: 'openai',
      model: 'gpt-4o',
      tokensIn: 1337,
      tokensOut: 977,
    });

    const { cost_usd } = (create.mock.calls[0]![0] as { data: { cost_usd: unknown } }).data;
    expect(typeof cost_usd).toBe('string');
    expect(cost_usd).toBe('0.013113');
  });

  it('attributes anonymous free-snapshot spend to the internal org instead of dropping it', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: null, feature: 'free_snapshot' },
      providerName: 'perplexity',
      model: 'sonar',
      tokensIn: 100,
      tokensOut: 100,
    });

    expect(withOrgContext.mock.calls[0]![0]).toBe(INTERNAL_ORG);
    const data = (create.mock.calls[0]![0] as { data: { organization_id: string; cost_usd: string } }).data;
    expect(data.organization_id).toBe(INTERNAL_ORG);
    // sonar: $1/M both ways on 200 tokens = $0.000200, plus the $0.005
    // flat per-request search fee.
    expect(data.cost_usd).toBe('0.005200');
  });

  it('skips the write and logs loudly when the internal org is unconfigured, rather than guessing a tenant', async () => {
    delete process.env.CRM_INTERNAL_ORG_ID;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: null, feature: 'free_snapshot' },
      providerName: 'openai',
      model: 'gpt-4o',
      tokensIn: 10,
      tokensOut: 10,
    });

    expect(create).not.toHaveBeenCalled();
    expect(withOrgContext).not.toHaveBeenCalled();
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged.msg).toBe('ai_usage_write_skipped_no_org');
    expect(logged.costUsd).toBe('0.000125');
  });

  it('warns on an unpriced model but still records the row (tokens are not lost)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'f' },
      providerName: 'openai',
      model: 'gpt-6-ultra-unreleased',
      tokensIn: 5000,
      tokensOut: 5000,
    });

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.msg).toBe('ai_usage_model_unpriced');
    const data = (create.mock.calls[0]![0] as { data: { tokens_in: number; cost_usd: string } }).data;
    expect(data.tokens_in).toBe(5000);
    expect(data.cost_usd).toBe('0.000000');
  });

  it('does not warn "unpriced" for a self-hosted model whose zero cost is real', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'f' },
      providerName: 'ollama',
      model: 'qwen3:8b',
      tokensIn: 5000,
      tokensOut: 5000,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the database write fails — it logs and resolves', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    create.mockRejectedValue(new Error('connection terminated'));
    const { recordAiUsage } = await import('./record.js');

    await expect(
      recordAiUsage({
        attribution: { organizationId: ORG_A, feature: 'f' },
        providerName: 'openai',
        model: 'gpt-4o',
        tokensIn: 1,
        tokensOut: 1,
      }),
    ).resolves.toBeUndefined();

    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged.msg).toBe('ai_usage_write_failed');
    expect(logged.error).toBe('connection terminated');
  });

  it('never rejects when setting the tenant context itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    withOrgContext.mockRejectedValueOnce(new Error('not a valid UUID'));
    const { recordAiUsage } = await import('./record.js');

    await expect(
      recordAiUsage({
        attribution: { organizationId: 'not-a-uuid', feature: 'f' },
        providerName: 'openai',
        model: 'gpt-4o',
        tokensIn: 1,
        tokensOut: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('truncates to the column widths in schema.prisma rather than losing the row to a 22001', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'f' },
      providerName: 'p'.repeat(80),
      model: 'm'.repeat(200),
      tokensIn: 1,
      tokensOut: 1,
      finishReason: 'r'.repeat(90),
    });

    const data = (create.mock.calls[0]![0] as { data: { provider_name: string; model: string; finish_reason: string } }).data;
    expect(data.provider_name).toHaveLength(50);
    expect(data.model).toHaveLength(100);
    expect(data.finish_reason).toHaveLength(50);
  });

  it('normalizes missing latency/finish-reason to null and clamps nonsense token counts', async () => {
    const { recordAiUsage } = await import('./record.js');

    await recordAiUsage({
      attribution: { organizationId: ORG_A, feature: 'f' },
      providerName: 'ollama',
      model: 'qwen3:8b',
      tokensIn: -3,
      tokensOut: 7.9,
    });

    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.latency_ms).toBeNull();
    expect(data.finish_reason).toBeNull();
    expect(data.tokens_in).toBe(0);
    expect(data.tokens_out).toBe(7);
  });
});
