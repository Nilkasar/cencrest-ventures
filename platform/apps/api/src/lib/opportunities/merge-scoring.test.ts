import { describe, expect, it } from 'vitest';
import {
  buildMergeResult,
  classifyMergeType,
  combineSignals,
  geoContentComplexity,
  geoGapScoreFromFinding,
  isMaterialChange,
  priorityFromScore,
  type MergeInput,
} from './merge-scoring.js';
import type { IntentGapFinding } from '../ai-visibility/competitive.js';

function seoSignal(overrides: Partial<NonNullable<MergeInput['seo']>> = {}): NonNullable<MergeInput['seo']> {
  return {
    keywordId: 'kw-1',
    keywordText: 'best freight visibility software',
    monthlyVolume: 1200,
    difficulty: 40,
    intent: 'commercial',
    matchedOpportunityId: 'opp-1',
    matchedOpportunityValueScore: null,
    ...overrides,
  };
}

function intentGapFinding(overrides: Partial<IntentGapFinding> = {}): IntentGapFinding {
  return {
    gapType: 'intent_gap',
    severity: 'high',
    queryId: 'q-1',
    queryText: 'best freight visibility software',
    yourMentionRatePct: 0,
    competitors: [{ competitorId: 'c-1', competitorName: 'CompetitorA', mentionRatePct: 84 }],
    ...overrides,
  };
}

function geoSignal(overrides: Partial<NonNullable<MergeInput['geo']>> = {}): NonNullable<MergeInput['geo']> {
  return {
    finding: intentGapFinding(),
    competitorEvidence: [
      {
        competitorId: 'c-1',
        competitorName: 'CompetitorA',
        competitorRunId: 'run-1',
        mentionRatePct: 84,
        sentence: 'For "best freight visibility software," CompetitorA appears in 84% of responses at position 1, you appear in 0% of responses.',
      },
    ],
    ...overrides,
  };
}

describe('combineSignals', () => {
  it('returns 0 when neither signal is present', () => {
    expect(combineSignals(null, null)).toBe(0);
  });

  it('equals the single signal exactly when only one is present', () => {
    expect(combineSignals(72, null)).toBe(72);
    expect(combineSignals(null, 55)).toBe(55);
  });

  it('is strictly greater than either signal alone when both are present and > 0', () => {
    const combined = combineSignals(90, 90);
    expect(combined).toBeGreaterThan(90);
    expect(combined).toBeLessThanOrEqual(100);
  });

  it('never exceeds 100 even at the extreme', () => {
    expect(combineSignals(100, 100)).toBe(100);
  });
});

describe('classifyMergeType', () => {
  it('classifies unified/seo/geo/null from presence alone, not magnitude', () => {
    expect(classifyMergeType(true, true)).toBe('unified');
    expect(classifyMergeType(true, false)).toBe('seo');
    expect(classifyMergeType(false, true)).toBe('geo');
    expect(classifyMergeType(false, false)).toBeNull();
  });
});

describe('geoGapScoreFromFinding', () => {
  it('is the best-performing competitor\'s mention rate', () => {
    const finding = intentGapFinding({
      competitors: [
        { competitorId: 'c-1', competitorName: 'A', mentionRatePct: 40 },
        { competitorId: 'c-2', competitorName: 'B', mentionRatePct: 84 },
      ],
    });
    expect(geoGapScoreFromFinding(finding)).toBe(84);
  });
});

describe('geoContentComplexity', () => {
  it('is higher for a high-severity gap than a medium one', () => {
    expect(geoContentComplexity('high')).toBeGreaterThan(geoContentComplexity('medium'));
    expect(geoContentComplexity('medium')).toBeGreaterThan(geoContentComplexity('low'));
  });
});

describe('priorityFromScore', () => {
  it('buckets high/medium/low from the documented thresholds', () => {
    expect(priorityFromScore(75)).toBe(1);
    expect(priorityFromScore(45)).toBe(2);
    expect(priorityFromScore(10)).toBe(3);
  });
});

describe('buildMergeResult', () => {
  it('returns null when neither signal is present', () => {
    expect(buildMergeResult({ queryId: 'q-1', queryText: 'x', seo: null, geo: null })).toBeNull();
  });

  it('produces a seo-typed opportunity from SEO signal alone, with one evidence row', () => {
    const result = buildMergeResult({ queryId: 'q-1', queryText: 'best freight visibility software', seo: seoSignal(), geo: null });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('seo');
    expect(result!.seoDemandScore).not.toBeNull();
    expect(result!.geoGapScore).toBeNull();
    expect(result!.evidence).toHaveLength(1);
    expect(result!.evidence[0]!.sourceTable).toBe('seo_keywords');
    expect(result!.evidence[0]!.summary).toContain('1200 monthly searches');
  });

  it('produces a geo-typed opportunity from GEO signal alone, with one evidence row per competitor, using Epic 8\'s exact sentence format', () => {
    const result = buildMergeResult({ queryId: 'q-1', queryText: 'best freight visibility software', seo: null, geo: geoSignal() });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('geo');
    expect(result!.seoDemandScore).toBeNull();
    expect(result!.geoGapScore).toBe(84);
    expect(result!.evidence).toHaveLength(1);
    expect(result!.evidence[0]!.sourceTable).toBe('ai_runs');
    expect(result!.evidence[0]!.summary).toBe(
      'For "best freight visibility software," CompetitorA appears in 84% of responses at position 1, you appear in 0% of responses.',
    );
  });

  it(
    "produces a unified opportunity scoring higher than either the seo-only or geo-only opportunity would, with evidence from BOTH signals",
    () => {
      // Moderate, non-saturating demand (500 monthly searches -> demand
      // score 50) so this exercises the realistic "both partial signals
      // combine to exceed either" case the epic's DoD describes — see
      // the "ties at the ceiling" test below for the documented edge case
      // where one signal is ALREADY at the 0-100 maximum on its own.
      const seo = seoSignal({ monthlyVolume: 500 });
      const geo = geoSignal();

      const seoOnly = buildMergeResult({ queryId: 'q-1', queryText: 'best freight visibility software', seo, geo: null })!;
      const geoOnly = buildMergeResult({ queryId: 'q-1', queryText: 'best freight visibility software', seo: null, geo })!;
      const unified = buildMergeResult({ queryId: 'q-1', queryText: 'best freight visibility software', seo, geo })!;

      expect(unified.type).toBe('unified');
      expect(unified.opportunityScore).toBeGreaterThan(seoOnly.opportunityScore);
      expect(unified.opportunityScore).toBeGreaterThan(geoOnly.opportunityScore);
      expect(unified.evidence).toHaveLength(2);
      expect(unified.evidence.some((e) => e.sourceTable === 'seo_keywords')).toBe(true);
      expect(unified.evidence.some((e) => e.sourceTable === 'ai_runs')).toBe(true);
    },
  );

  it('never scores unified BELOW either standalone signal, even at the 0-100 demand ceiling (an already-maxed signal cannot be pushed higher — documented, not a bug)', () => {
    // monthlyVolume 1200 saturates normalizeDemandScore at 100 (Epic 4's own
    // clamp) — the ceiling edge case this file's header comment documents.
    const seo = seoSignal({ monthlyVolume: 1200 });
    const geo = geoSignal();

    const seoOnly = buildMergeResult({ queryId: 'q-1', queryText: 'x', seo, geo: null })!;
    const geoOnly = buildMergeResult({ queryId: 'q-1', queryText: 'x', seo: null, geo })!;
    const unified = buildMergeResult({ queryId: 'q-1', queryText: 'x', seo, geo })!;

    expect(unified.opportunityScore).toBeGreaterThanOrEqual(seoOnly.opportunityScore);
    expect(unified.opportunityScore).toBeGreaterThanOrEqual(geoOnly.opportunityScore);
  });

  it('falls back to normalizeDemandScore when no matched seo_opportunities row exists (manually-added keyword)', () => {
    const withMatch = buildMergeResult({
      queryId: 'q-1',
      queryText: 'x',
      seo: seoSignal({ matchedOpportunityValueScore: 88 }),
      geo: null,
    })!;
    const withoutMatch = buildMergeResult({
      queryId: 'q-1',
      queryText: 'x',
      seo: seoSignal({ matchedOpportunityId: null, matchedOpportunityValueScore: null }),
      geo: null,
    })!;
    expect(withMatch.seoDemandScore).toBe(88);
    expect(withoutMatch.seoDemandScore).not.toBeNull();
    expect(withoutMatch.seoDemandScore).not.toBe(88);
  });
});

describe('isMaterialChange', () => {
  it('is always material when the type changes, regardless of score delta', () => {
    expect(isMaterialChange({ type: 'seo', opportunityScore: 50 }, { type: 'unified', opportunityScore: 51 })).toBe(true);
  });

  it('is material when the score moves by at least the documented threshold', () => {
    expect(isMaterialChange({ type: 'seo', opportunityScore: 50 }, { type: 'seo', opportunityScore: 66 })).toBe(true);
  });

  it('is NOT material for a small score wobble with the same type', () => {
    expect(isMaterialChange({ type: 'seo', opportunityScore: 50 }, { type: 'seo', opportunityScore: 55 })).toBe(false);
  });
});
