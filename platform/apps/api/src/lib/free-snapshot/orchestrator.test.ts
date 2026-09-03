import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock @bebest/database down to what orchestrator.ts touches ───────────
const db = {
  snapshot_requests: { update: vi.fn().mockResolvedValue({}) },
};
vi.mock('@bebest/database', () => ({ db }));

// ── Mock every sub-pipeline module orchestrator.ts calls, so this test can
// assert EXACTLY what parameters each one received — the epic's DoD:
// "a test proving each sub-pipeline call receives free-tier-scoped
// parameters (page cap, query cap), not paid-tier ones." ──────────────────
const crawlFreeSnapshotSite = vi.fn();
vi.mock('./crawl.js', () => ({ crawlFreeSnapshotSite }));

const generateQueryUniverse = vi.fn();
vi.mock('../query-generator.js', () => ({ generateQueryUniverse }));

const runFreeSnapshotAiQueries = vi.fn();
vi.mock('./ai-run.js', () => ({ runFreeSnapshotAiQueries }));

const analyzeFreeSnapshotSeo = vi.fn();
vi.mock('./seo-analysis.js', () => ({ analyzeFreeSnapshotSeo }));

const buildFreeSnapshotReport = vi.fn();
vi.mock('./report.js', () => ({ buildFreeSnapshotReport }));

const FAKE_CRAWL_RESULT = { rootUrl: 'https://acme.example', pages: [], pagesCrawled: 0, pagesFailed: 0, rootFetchFailed: null };
const FAKE_QUERIES = [{ text: 'q', category: 'category', intentType: 'informational', tags: [], priority: 3 }];
const FAKE_AI_RESULT = {
  providers: ['openai', 'anthropic', 'google', 'perplexity'],
  totalQueries: 1,
  observations: [],
  score: { mentionScore: 0, recommendationScore: 0, positionScore: 0, coverageScore: 0, aiVisibilityScore: 0, formulaVersion: '1.0' },
};
const FAKE_SEO_RESULT = { pagesAnalyzed: 0, averageTechnicalScore: 0, contentScore: 0, pages: [], issues: [] };
const FAKE_REPORT = { generatedAt: 'now', report: true };

const INPUT = {
  name: 'Ada',
  email: 'ada@acme.example',
  company: 'Acme',
  website: 'https://acme.example',
  category: 'CRM software',
  biggestCompetitor: 'Rival Inc',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.snapshot_requests.update.mockResolvedValue({});
  crawlFreeSnapshotSite.mockResolvedValue(FAKE_CRAWL_RESULT);
  generateQueryUniverse.mockReturnValue(FAKE_QUERIES);
  runFreeSnapshotAiQueries.mockResolvedValue(FAKE_AI_RESULT);
  analyzeFreeSnapshotSeo.mockReturnValue(FAKE_SEO_RESULT);
  buildFreeSnapshotReport.mockReturnValue(FAKE_REPORT);
});

describe('runFreeSnapshotPipeline — free-tier-scoping proof (DoD)', () => {
  it('calls the crawl with the free plan\'s pages_analyzed cap (10), never a paid-tier number', async () => {
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };

    await runFreeSnapshotPipeline('snap-1', 'raw-token', INPUT, { emailSender });

    expect(crawlFreeSnapshotSite).toHaveBeenCalledWith('https://acme.example', 10, undefined);
  });

  it('calls the query generator with the free plan\'s queries_per_query_set cap (50), never a paid-tier number', async () => {
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };

    await runFreeSnapshotPipeline('snap-1', 'raw-token', INPUT, { emailSender });

    expect(generateQueryUniverse).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }), 50);
  });

  it('lets a test override the caps explicitly (proving the cap is a real, threaded parameter, not a silently-ignored one)', async () => {
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };

    await runFreeSnapshotPipeline('snap-1', 'raw-token', INPUT, { emailSender, maxPages: 3, maxQueries: 5 });

    expect(crawlFreeSnapshotSite).toHaveBeenCalledWith('https://acme.example', 3, undefined);
    expect(generateQueryUniverse).toHaveBeenCalledWith(expect.anything(), 5);
  });

  it('runs the AI query step against ONLY the capped query list the generator returned, never the uncapped candidate set', async () => {
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };

    await runFreeSnapshotPipeline('snap-1', 'raw-token', INPUT, { emailSender });

    expect(runFreeSnapshotAiQueries).toHaveBeenCalledWith('Acme', FAKE_QUERIES, undefined);
  });

  it('runs every step in order, marks the row processing then complete, persists the report, and attempts the ready email with the raw token in the link', async () => {
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn().mockResolvedValue(undefined), sendNotification: vi.fn() };

    await runFreeSnapshotPipeline('snap-1', 'raw-token-xyz', INPUT, { emailSender, reportBaseUrl: 'https://app.bebestwith.ai' });

    const calls = db.snapshot_requests.update.mock.calls.map((c: unknown[]) => (c[0] as { data: Record<string, unknown> }).data);
    expect(calls[0]).toMatchObject({ status: 'processing' });
    expect(calls[1]).toMatchObject({ status: 'complete', result_json: FAKE_REPORT });

    expect(analyzeFreeSnapshotSeo).toHaveBeenCalledWith(FAKE_CRAWL_RESULT);
    expect(buildFreeSnapshotReport).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ada', company: 'Acme', biggestCompetitor: 'Rival Inc' }),
      FAKE_SEO_RESULT,
      FAKE_AI_RESULT,
    );

    expect(emailSender.sendSnapshotReady).toHaveBeenCalledWith({
      to: 'ada@acme.example',
      reportUrl: 'https://app.bebestwith.ai/snapshot/raw-token-xyz',
    });
  });

  it('marks the row failed (never throws) when a sub-pipeline step rejects, and still does not send an email', async () => {
    crawlFreeSnapshotSite.mockRejectedValue(new Error('crawl exploded'));
    const { runFreeSnapshotPipeline } = await import('./orchestrator.js');
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };

    await expect(runFreeSnapshotPipeline('snap-1', 'raw-token', INPUT, { emailSender })).resolves.toBeUndefined();

    const lastCall = db.snapshot_requests.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(lastCall.data.status).toBe('failed');
    expect((lastCall.data.result_json as { error: string }).error).toContain('crawl exploded');
    expect(emailSender.sendSnapshotReady).not.toHaveBeenCalled();
  });
});
