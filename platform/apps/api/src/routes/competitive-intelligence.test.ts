import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  competitors: { findMany: vi.fn(), findFirst: vi.fn() },
  query_sets: { findFirst: vi.fn() },
  queries: { findMany: vi.fn() },
  ai_runs: { findFirst: vi.fn() },
  brand_observations: { findMany: vi.fn() },
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
};

const tx = {
  organizations: db.organizations,
  memberships: db.memberships,
  users: db.users,
  brands: db.brands,
  competitors: db.competitors,
  query_sets: db.query_sets,
  queries: db.queries,
  ai_runs: db.ai_runs,
  brand_observations: db.brand_observations,
};

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: competitiveIntelligence } = await import('./competitive-intelligence.js');
  const app = new Hono();
  app.route('/brands/me', competitiveIntelligence);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme' };
const QUERY_SET = { id: 'qs-1', organization_id: 'org-1', brand_id: 'brand-1', status: 'active', deleted_at: null };
const QUERIES = [
  { id: 'q1', text: 'best freight visibility software', intent_type: 'commercial', category: 'category', created_at: new Date('2026-01-01'), deleted_at: null },
];

const COMPETITOR = { id: 'competitor-1', organization_id: 'org-1', brand_id: 'brand-1', name: 'CompetitorA', deleted_at: null, created_at: new Date() };

function obs(overrides: Partial<Record<string, unknown>>) {
  return {
    query_id: 'q1',
    brand_mentioned: false,
    brand_recommended: false,
    brand_first_position: null,
    cited_domains: [],
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.brands.findFirst.mockResolvedValue(BRAND);
  db.query_sets.findFirst.mockResolvedValue(QUERY_SET);
  db.queries.findMany.mockResolvedValue(QUERIES);
  db.competitors.findMany.mockResolvedValue([COMPETITOR]);
});

describe('GET /brands/me/competitive-gaps', () => {
  it('404s when the brand has no active query set', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/competitive-gaps', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
    expect((await res.json() as Record<string, unknown>).error).toBe('no_active_query_set');
  });

  it('returns computed: false with empty gaps when the brand has no completed run yet', async () => {
    db.ai_runs.findFirst.mockResolvedValue(null); // neither brand nor competitor has a completed run
    const app = await buildApp();
    const res = await app.request('/brands/me/competitive-gaps', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.computed).toBe(false);
    expect(body.brandRun).toBeNull();
    expect(body.gaps).toEqual([]);
    expect(body.perQueryBreakdown).toEqual([]);
  });

  it(
    'produces the per-query breakdown sentence in the spec\'s exact evidence format, and labels every gap with an explicit gapType',
    async () => {
      const BRAND_RUN = {
        id: 'run-brand-1',
        organization_id: 'org-1',
        brand_id: 'brand-1',
        competitor_id: null,
        query_set_id: 'qs-1',
        providers: ['openai', 'anthropic', 'google', 'perplexity'],
        status: 'completed',
        total_jobs: 4,
        ai_visibility_score: '10.00',
        created_at: new Date('2026-01-02'),
        completed_at: new Date('2026-01-02'),
      };
      const COMPETITOR_RUN = {
        ...BRAND_RUN,
        id: 'run-competitor-1',
        competitor_id: 'competitor-1',
        ai_visibility_score: '55.00',
      };

      // Brand's own AI run: mentioned in 1 of 4 provider responses for q1
      // (2% would need 50 providers to render literally as "2%"; use a
      // round, exact number here — 25% — and assert the format, not the
      // spec's illustrative digits).
      db.ai_runs.findFirst.mockImplementation(
        async ({ where }: { where: { competitor_id: string | null } }) =>
          where.competitor_id === null ? BRAND_RUN : COMPETITOR_RUN,
      );
      db.brand_observations.findMany.mockImplementation(async ({ where }: { where: { ai_run_id: string } }) => {
        if (where.ai_run_id === BRAND_RUN.id) {
          return [obs({ brand_mentioned: true, brand_first_position: 0.9 }), obs({}), obs({}), obs({})];
        }
        // Competitor: mentioned in 3 of 4, earliest position 0.1, cites g2.com
        return [
          obs({ brand_mentioned: true, brand_first_position: 0.1, cited_domains: ['g2.com'] }),
          obs({ brand_mentioned: true, brand_first_position: 0.2 }),
          obs({ brand_mentioned: true, brand_first_position: 0.3 }),
          obs({}),
        ];
      });

      const app = await buildApp();
      const res = await app.request('/brands/me/competitive-gaps', { headers: await authHeader('user-1', 'org-1') });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        computed: boolean;
        brandRun: { aiVisibilityScore: number };
        competitors: Array<{ competitorId: string; competitiveGap: number }>;
        perQueryBreakdown: Array<{ competitors: Array<{ sentence: string }> }>;
        gaps: Array<{ gapType: string }>;
      };

      expect(body.computed).toBe(true);
      expect(body.competitors[0]!.competitiveGap).toBeCloseTo(45, 5); // 55 - 10

      const sentence = body.perQueryBreakdown[0]!.competitors[0]!.sentence;
      expect(sentence).toBe(
        'For "best freight visibility software," CompetitorA appears in 75% of responses at position 1, you appear in 25% of responses at position 4.',
      );

      // Every gap finding is independently identifiable via `gapType` —
      // no consumer has to infer which of the four types it is.
      for (const gap of body.gaps) {
        expect(['intent_gap', 'content_gap', 'entity_gap', 'source_gap']).toContain(gap.gapType);
      }
    },
  );
});

describe('GET /brands/me/share-of-voice', () => {
  it('is a sane 0% (never NaN) when nobody has any completed run at all', async () => {
    db.ai_runs.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/share-of-voice', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalMentions).toBe(0);
    expect(body.yourSharePct).toBe(0);
  });

  it('computes the correct split for a single tracked competitor', async () => {
    const BRAND_RUN = {
      id: 'run-brand-1',
      competitor_id: null,
      providers: ['openai', 'anthropic', 'google', 'perplexity'],
      status: 'completed',
      created_at: new Date('2026-01-02'),
    };
    const COMPETITOR_RUN = { ...BRAND_RUN, id: 'run-competitor-1', competitor_id: 'competitor-1' };

    db.ai_runs.findFirst.mockImplementation(
      async ({ where }: { where: { competitor_id: string | null } }) => (where.competitor_id === null ? BRAND_RUN : COMPETITOR_RUN),
    );
    db.brand_observations.findMany.mockImplementation(async ({ where }: { where: { ai_run_id: string } }) =>
      where.ai_run_id === BRAND_RUN.id
        ? [obs({ brand_mentioned: true }), obs({})]
        : [obs({ brand_mentioned: true }), obs({ brand_mentioned: true }), obs({ brand_mentioned: true })],
    );

    const app = await buildApp();
    const res = await app.request('/brands/me/share-of-voice', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { yourMentions: number; totalMentions: number; yourSharePct: number; competitors: Array<{ mentions: number; sharePct: number }> };

    expect(body.yourMentions).toBe(1);
    expect(body.totalMentions).toBe(4); // 1 + 3
    expect(body.yourSharePct).toBe(25);
    expect(body.competitors[0]!.mentions).toBe(3);
    expect(body.competitors[0]!.sharePct).toBe(75);
  });
});
