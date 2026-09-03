import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getCurrentScoreSnapshot } from './current-score-snapshot.js';

const db = {
  ai_runs: { findFirst: vi.fn() },
  seo_analyses: { findMany: vi.fn(), findFirst: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.ai_runs.findFirst.mockResolvedValue(null);
  db.seo_analyses.findMany.mockResolvedValue([]);
  db.seo_analyses.findFirst.mockResolvedValue(null);
});

describe('getCurrentScoreSnapshot', () => {
  it('returns geo: null, seo: null when the brand has no data at all yet', async () => {
    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');
    expect(snapshot.geo).toBeNull();
    expect(snapshot.seo).toBeNull();
    expect(snapshot.capturedAt).toBeTruthy();
  });

  it('reads the GEO component verbatim from the latest COMPLETED ai_runs row — zero recomputation', async () => {
    db.ai_runs.findFirst.mockResolvedValue({
      id: 'run-1',
      ai_visibility_score: '42.50',
      mention_score: '40.00',
      recommendation_score: '45.00',
      position_score: '38.00',
      coverage_score: '50.00',
      scoring_formula_version: '1.0',
      completed_at: new Date('2026-02-01T00:00:00.000Z'),
      created_at: new Date('2026-01-30T00:00:00.000Z'),
    });
    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');

    expect(snapshot.geo).toEqual({
      aiRunId: 'run-1',
      aiVisibilityScore: 42.5,
      mentionScore: 40,
      recommendationScore: 45,
      positionScore: 38,
      coverageScore: 50,
      formulaVersion: '1.0',
      measuredAt: '2026-02-01T00:00:00.000Z',
    });

    // Never reads any other brand's/org's data, and never a run in progress
    // (the where clause itself is what enforces this — asserted directly).
    expect(db.ai_runs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-1', brand_id: 'brand-1', competitor_id: null, status: 'completed' }) }),
    );
  });

  it('never returns a GEO component for a run that has not finished AGGREGATE yet', async () => {
    db.ai_runs.findFirst.mockResolvedValue({ id: 'run-1', ai_visibility_score: null, created_at: new Date(), completed_at: null });
    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');
    expect(snapshot.geo).toBeNull();
  });

  it('averages the LATEST score per page (technical) plus the latest content score into one SEO component', async () => {
    db.seo_analyses.findMany.mockResolvedValue([
      { page_id: 'page-1', score: 80, analyzed_at: new Date('2026-02-01T00:00:00.000Z') },
      { page_id: 'page-2', score: 60, analyzed_at: new Date('2026-02-02T00:00:00.000Z') },
    ]);
    db.seo_analyses.findFirst.mockResolvedValue({ score: 70, analyzed_at: new Date('2026-02-03T00:00:00.000Z') });

    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');

    expect(snapshot.seo).toEqual({
      overallScore: 70, // average of technicalScore(70) and contentScore(70) -> (70+70)/2 = 70
      technicalScore: 70, // average of 80 and 60
      contentScore: 70,
      pagesAnalyzed: 2,
      formulaVersion: '1.0',
      measuredAt: '2026-02-03T00:00:00.000Z', // the max of all three timestamps
    });
  });

  it('requests DISTINCT technical rows by page_id, latest first — never averages stale historical rows for a re-analyzed page', async () => {
    await getCurrentScoreSnapshot('org-1', 'brand-1');
    expect(db.seo_analyses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ analysis_type: 'technical' }),
        orderBy: { analyzed_at: 'desc' },
        distinct: ['page_id'],
      }),
    );
  });

  it('produces an SEO component from technical data alone when there is no content-level analysis yet', async () => {
    db.seo_analyses.findMany.mockResolvedValue([{ page_id: 'page-1', score: 90, analyzed_at: new Date('2026-02-01T00:00:00.000Z') }]);
    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');
    expect(snapshot.seo?.overallScore).toBe(90);
    expect(snapshot.seo?.contentScore).toBeNull();
  });

  it('is independent per component: a GEO-only brand never fabricates an SEO component, and vice versa', async () => {
    db.ai_runs.findFirst.mockResolvedValue({
      id: 'run-1',
      ai_visibility_score: '55.00',
      mention_score: null,
      recommendation_score: null,
      position_score: null,
      coverage_score: null,
      scoring_formula_version: '1.0',
      completed_at: new Date(),
      created_at: new Date(),
    });
    const snapshot = await getCurrentScoreSnapshot('org-1', 'brand-1');
    expect(snapshot.geo).not.toBeNull();
    expect(snapshot.seo).toBeNull();
  });
});
