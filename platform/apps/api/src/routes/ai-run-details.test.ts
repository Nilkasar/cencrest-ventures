import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  ai_runs: { findFirst: vi.fn() },
  ai_run_responses: { findMany: vi.fn(), count: vi.fn() },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  ai_runs: db.ai_runs,
  ai_run_responses: db.ai_run_responses,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: aiRunDetails } = await import('./ai-run-details.js');
  const app = new Hono();
  app.route('/ai-runs', aiRunDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const RUN_COMPLETED = {
  id: 'run-1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  query_set_id: 'qs-1',
  providers: ['openai', 'anthropic', 'google', 'perplexity'],
  status: 'completed',
  total_jobs: 4,
  completed_jobs: 3,
  failed_jobs: 1,
  mention_score: 50,
  recommendation_score: 50,
  position_score: 65,
  coverage_score: 100,
  ai_visibility_score: 60.5,
  scoring_formula_version: '1.0',
  error: null,
  started_at: new Date('2026-01-01T00:00:00Z'),
  completed_at: new Date('2026-01-01T00:05:00Z'),
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:05:00Z'),
};

beforeEach(async () => {
  vi.clearAllMocks();
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.ai_runs.findFirst.mockResolvedValue(RUN_COMPLETED);
});

describe('GET /ai-runs/:id', () => {
  it('returns the run with a computed progressPct', async () => {
    const app = await buildApp();
    const res = await app.request('/ai-runs/run-1', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'run-1', status: 'completed', progressPct: 100, aiVisibilityScore: 60.5 });
  });

  it('404s for a run belonging to another org (or not found at all) — never a 403 that confirms existence', async () => {
    db.ai_runs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/ai-runs/someone-elses-run', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });
});

describe('GET /ai-runs/:id/score', () => {
  it('returns a breakdown whose four weighted contributions sum to the stored composite', async () => {
    const app = await buildApp();
    const res = await app.request('/ai-runs/run-1/score', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      computed: boolean;
      aiVisibilityScore: number;
      scoringFormulaVersion: string;
      breakdown: Record<string, { value: number; weight: number; weightedContribution: number }>;
    };

    expect(body.computed).toBe(true);
    expect(body.scoringFormulaVersion).toBe('1.0');
    expect(body.breakdown.mentionScore).toEqual({ value: 50, weight: 0.25, weightedContribution: 12.5 });
    expect(body.breakdown.recommendationScore).toEqual({ value: 50, weight: 0.4, weightedContribution: 20 });
    expect(body.breakdown.positionScore).toEqual({ value: 65, weight: 0.2, weightedContribution: 13 });
    expect(body.breakdown.coverageScore).toEqual({ value: 100, weight: 0.15, weightedContribution: 15 });

    const sum = Object.values(body.breakdown).reduce((acc, c) => acc + c.weightedContribution, 0);
    expect(Math.round(sum * 100) / 100).toBe(body.aiVisibilityScore);
  });

  it('returns computed: false with null score fields for a run still in progress (not an error)', async () => {
    db.ai_runs.findFirst.mockResolvedValue({
      ...RUN_COMPLETED,
      status: 'running',
      mention_score: null,
      recommendation_score: null,
      position_score: null,
      coverage_score: null,
      ai_visibility_score: null,
      scoring_formula_version: null,
    });
    const app = await buildApp();
    const res = await app.request('/ai-runs/run-1/score', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.computed).toBe(false);
    expect(body.aiVisibilityScore).toBeNull();
  });
});

describe('GET /ai-runs/:id/responses', () => {
  it('returns raw responses paginated, each with its linked observation for score -> observation -> raw-response drill-down', async () => {
    db.ai_run_responses.findMany.mockResolvedValue([
      {
        id: 'resp-1',
        query_id: 'q1',
        provider: 'openai',
        model: 'gpt-4o',
        prompt_version: 'brand-query.v1.0',
        temperature: 0.7,
        raw_response: 'Acme is a great choice.',
        request_id: 'req-1',
        tokens_prompt: 10,
        tokens_completion: 20,
        tokens_total: 30,
        latency_ms: 500,
        extraction_status: 'completed',
        extraction_error: null,
        extracted_at: new Date(),
        created_at: new Date(),
        brand_observations: {
          id: 'obs-1',
          query_id: 'q1',
          ai_run_response_id: 'resp-1',
          brand_mentioned: true,
          brand_first_position: 0.1,
          brand_mention_count: 1,
          brand_sentiment: 'positive',
          brand_context: 'Acme is a great choice',
          brand_recommended: true,
          brand_recommendation_strength: 'strong',
          competitors_mentioned: [],
          cited_urls: [],
          cited_domains: [],
          response_language: 'en',
          response_word_count: 5,
          extraction_model_used: 'qwen3:8b',
          extraction_prompt_version: 'extraction-brand-observation.v1.0',
          extraction_confidence: 'high',
          created_at: new Date(),
        },
      },
      {
        id: 'resp-2',
        query_id: 'q2',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        prompt_version: 'brand-query.v1.0',
        temperature: 0.7,
        raw_response: 'Something unrelated.',
        request_id: 'req-2',
        tokens_prompt: 8,
        tokens_completion: 15,
        tokens_total: 23,
        latency_ms: 300,
        extraction_status: 'failed',
        extraction_error: 'extract<T>() failed to produce schema-valid JSON after 3 attempt(s).',
        extracted_at: null,
        created_at: new Date(),
        brand_observations: null,
      },
    ]);
    db.ai_run_responses.count.mockResolvedValue(2);

    const app = await buildApp();
    const res = await app.request('/ai-runs/run-1/responses', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number; limit: number; offset: number };

    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Evidence is present and readable even for the failed-extraction row.
    expect(body.items[1]).toMatchObject({
      id: 'resp-2',
      rawResponse: 'Something unrelated.',
      extractionStatus: 'failed',
      observation: null,
    });
    // score -> observation -> raw response: the observation is embedded
    // directly on its response, linked by aiRunResponseId.
    expect(body.items[0]!.observation).toMatchObject({ id: 'obs-1', aiRunResponseId: 'resp-1', brandMentioned: true });

    expect(db.ai_run_responses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ai_run_id: 'run-1', organization_id: 'org-1' }),
        include: { brand_observations: true },
        skip: 0,
        take: 50,
      }),
    );
  });

  it('404s when the run does not exist for this org', async () => {
    db.ai_runs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/ai-runs/nope/responses', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });
});
