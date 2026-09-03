import { describe, expect, it } from 'vitest';
import { computeScoreDelta, type GeoScoreComponent, type ScoreSnapshot, type SeoScoreComponent } from './scoring.js';

function geoSnapshot(overrides: Partial<GeoScoreComponent> = {}): ScoreSnapshot {
  return {
    geo: {
      aiRunId: 'run-1',
      aiVisibilityScore: 40,
      mentionScore: 40,
      recommendationScore: 40,
      positionScore: 40,
      coverageScore: 40,
      formulaVersion: '1.0',
      measuredAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
    seo: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
  };
}

function seoSnapshot(overrides: Partial<SeoScoreComponent> = {}): ScoreSnapshot {
  return {
    geo: null,
    seo: {
      overallScore: 60,
      technicalScore: 60,
      contentScore: 60,
      pagesAnalyzed: 5,
      formulaVersion: '1.0',
      measuredAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
    capturedAt: '2026-01-01T00:00:00.000Z',
  };
}

const EMPTY: ScoreSnapshot = { geo: null, seo: null, capturedAt: '2026-01-01T00:00:00.000Z' };

describe('computeScoreDelta', () => {
  it('is a pure function: identical inputs always produce identical output', () => {
    const before = geoSnapshot({ aiVisibilityScore: 40 });
    const after = geoSnapshot({ aiVisibilityScore: 55 });
    const first = computeScoreDelta(before, after);
    const second = computeScoreDelta(before, after);
    expect(first).toEqual(second);
  });

  it('computes GEO delta as after - before, rounded to 2 decimals', () => {
    const before = geoSnapshot({ aiVisibilityScore: 40.111 });
    const after = geoSnapshot({ aiVisibilityScore: 55.666 });
    const result = computeScoreDelta(before, after);
    expect(result.basis).toBe('geo');
    expect(result.delta).toBe(15.56); // 55.666 - 40.111 = 15.555 -> rounds to 15.56
  });

  it('reports a negative delta for a declining score', () => {
    const before = geoSnapshot({ aiVisibilityScore: 60 });
    const after = geoSnapshot({ aiVisibilityScore: 45 });
    const result = computeScoreDelta(before, after);
    expect(result.delta).toBe(-15);
  });

  it('reports formulaVersionsMatch: true when both sides share a version', () => {
    const before = geoSnapshot({ formulaVersion: '1.0' });
    const after = geoSnapshot({ formulaVersion: '1.0' });
    expect(computeScoreDelta(before, after).formulaVersionsMatch).toBe(true);
  });

  it('reports formulaVersionsMatch: false when versions differ', () => {
    const before = geoSnapshot({ formulaVersion: '1.0' });
    const after = geoSnapshot({ formulaVersion: '1.1' });
    expect(computeScoreDelta(before, after).formulaVersionsMatch).toBe(false);
  });

  it('prefers GEO over SEO when both sides have both components', () => {
    const before: ScoreSnapshot = { ...geoSnapshot({ aiVisibilityScore: 40 }), seo: seoSnapshot({ overallScore: 60 }).seo };
    const after: ScoreSnapshot = { ...geoSnapshot({ aiVisibilityScore: 50 }), seo: seoSnapshot({ overallScore: 90 }).seo };
    const result = computeScoreDelta(before, after);
    expect(result.basis).toBe('geo');
    expect(result.delta).toBe(10); // GEO delta (50-40), not SEO's 30
  });

  it('falls back to SEO when GEO has no comparable pair', () => {
    const before = seoSnapshot({ overallScore: 60 });
    const after = seoSnapshot({ overallScore: 72 });
    const result = computeScoreDelta(before, after);
    expect(result.basis).toBe('seo');
    expect(result.delta).toBe(12);
  });

  it('falls back to SEO when only the AFTER side is missing GEO', () => {
    const before = geoSnapshot({ aiVisibilityScore: 40 });
    before.seo = seoSnapshot({ overallScore: 60 }).seo;
    const after = seoSnapshot({ overallScore: 70 }); // no geo on the after side
    const result = computeScoreDelta(before, after);
    expect(result.basis).toBe('seo');
    expect(result.delta).toBe(10);
  });

  it('returns delta: null, basis: none when neither side has any comparable component', () => {
    const result = computeScoreDelta(EMPTY, EMPTY);
    expect(result).toEqual({ delta: null, basis: 'none', formulaVersionsMatch: null });
  });

  it('returns none when before has data but after has none at all', () => {
    const before = geoSnapshot();
    const result = computeScoreDelta(before, EMPTY);
    expect(result.basis).toBe('none');
    expect(result.delta).toBeNull();
  });

  it('a zero delta is reported as 0, not null (a real "no change" is not the same as "no data")', () => {
    const snapshot = geoSnapshot({ aiVisibilityScore: 40 });
    const result = computeScoreDelta(snapshot, snapshot);
    expect(result.delta).toBe(0);
    expect(result.basis).toBe('geo');
  });
});
