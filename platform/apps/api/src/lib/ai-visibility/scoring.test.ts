import { describe, expect, it } from 'vitest';
import {
  AVS_FORMULA_VERSION,
  computeAiVisibilityScore,
  computeCoverageScore,
  computeMentionScore,
  computePositionScore,
  computeRecommendationScore,
  type ScoredObservation,
} from './scoring.js';

// 2 queries x 2 providers = 4 planned jobs, all 4 succeeded.
const SCENARIO_A: readonly ScoredObservation[] = [
  { queryId: 'q1', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0.0 },
  { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.5 },
  { queryId: 'q2', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
  { queryId: 'q2', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0.25 },
];

describe('computeMentionScore', () => {
  it('mentioned / (queries x models) x 100 — hand-verified: 3 mentioned / 4 = 75', () => {
    expect(computeMentionScore({ observations: SCENARIO_A, totalQueries: 2, totalProviders: 2 })).toBe(75);
  });

  it('is 0 when nothing was mentioned', () => {
    const none = SCENARIO_A.map((o) => ({ ...o, brandMentioned: false }));
    expect(computeMentionScore({ observations: none, totalQueries: 2, totalProviders: 2 })).toBe(0);
  });

  it('is 0 (not NaN/Infinity) when totalQueries x totalProviders is 0', () => {
    expect(computeMentionScore({ observations: [], totalQueries: 0, totalProviders: 4 })).toBe(0);
  });

  it('denominator is the PLANNED (queries x models) total, not the number of observations that actually exist', () => {
    // Only 1 observation exists (3 jobs failed with no evidence at all —
    // no ai_run_responses row, so no observation), but the plan was
    // 2 queries x 2 providers = 4 jobs. The literal formula text
    // ("mentioned / (queries x models)") uses the planned total.
    const onlyOne: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.1 },
    ];
    expect(computeMentionScore({ observations: onlyOne, totalQueries: 2, totalProviders: 2 })).toBe(25);
  });
});

describe('computeRecommendationScore', () => {
  it('(distinct queries recommended) / queries x 100 — hand-verified: {q1, q2} / 2 = 100', () => {
    expect(computeRecommendationScore({ observations: SCENARIO_A, totalQueries: 2 })).toBe(100);
  });

  it('counts a query once even if recommended by multiple providers', () => {
    const bothRecommendQ1: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0 },
      { queryId: 'q1', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0.2 },
    ];
    expect(computeRecommendationScore({ observations: bothRecommendQ1, totalQueries: 4 })).toBe(25);
  });

  it('is 0 when totalQueries is 0', () => {
    expect(computeRecommendationScore({ observations: [], totalQueries: 0 })).toBe(0);
  });
});

describe('computePositionScore', () => {
  it('average(1 - first_position) x 100 — hand-verified: avg(1.0, 0.5, 0.75) x 100 = 75', () => {
    expect(computePositionScore(SCENARIO_A)).toBe(75);
  });

  it('position 0 (very first character) scores the maximum, 100', () => {
    expect(computePositionScore([{ queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0 }])).toBe(100);
  });

  it('position 1 (very last character) scores the minimum, 0', () => {
    expect(computePositionScore([{ queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 1 }])).toBe(0);
  });

  it('is 0 when no observation has a position (brand never mentioned anywhere)', () => {
    expect(computePositionScore([{ queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null }])).toBe(0);
  });

  it('excludes null positions from the average rather than treating them as 0', () => {
    const mixed: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0 }, // weight 1.0
      { queryId: 'q2', brandMentioned: false, brandRecommended: false, brandFirstPosition: null }, // excluded
    ];
    // If null were coerced to a position, this would drag the average down.
    // Excluded: average is just [1.0] = 100.
    expect(computePositionScore(mixed)).toBe(100);
  });
});

describe('computeCoverageScore', () => {
  it('(distinct queries mentioned) / total_intents x 100 — hand-verified: {q1, q2} / 2 = 100', () => {
    expect(computeCoverageScore({ observations: SCENARIO_A, totalQueries: 2 })).toBe(100);
  });

  it('a query mentioned by only one of several providers still counts as covered', () => {
    const partial: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.3 },
      { queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
      { queryId: 'q2', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
    ];
    expect(computeCoverageScore({ observations: partial, totalQueries: 2 })).toBe(50);
  });

  it('is 0 when totalQueries is 0', () => {
    expect(computeCoverageScore({ observations: [], totalQueries: 0 })).toBe(0);
  });
});

describe('computeAiVisibilityScore', () => {
  it('composes all four components with the stated weights — hand-verified fixed inputs', () => {
    // mentionScore=75, recommendationScore=100, positionScore=75, coverageScore=100
    // AVS = 75*0.25 + 100*0.40 + 75*0.20 + 100*0.15 = 18.75 + 40 + 15 + 15 = 88.75
    const result = computeAiVisibilityScore({ observations: SCENARIO_A, totalQueries: 2, totalProviders: 2 });
    expect(result).toEqual({
      mentionScore: 75,
      recommendationScore: 100,
      positionScore: 75,
      coverageScore: 100,
      aiVisibilityScore: 88.75,
      formulaVersion: '1.0',
    });
  });

  it('is all-zero for a run with zero mentions/recommendations/coverage', () => {
    const zero: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
      { queryId: 'q2', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
    ];
    const result = computeAiVisibilityScore({ observations: zero, totalQueries: 2, totalProviders: 4 });
    expect(result).toEqual({
      mentionScore: 0,
      recommendationScore: 0,
      positionScore: 0,
      coverageScore: 0,
      aiVisibilityScore: 0,
      formulaVersion: '1.0',
    });
  });

  it('is a perfect 100 when the brand is mentioned, recommended, first, and covers every query', () => {
    const perfect: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0 },
      { queryId: 'q2', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0 },
    ];
    const result = computeAiVisibilityScore({ observations: perfect, totalQueries: 2, totalProviders: 1 });
    expect(result.aiVisibilityScore).toBe(100);
  });

  it('stamps the current formula version constant, not a hardcoded literal', () => {
    const result = computeAiVisibilityScore({ observations: [], totalQueries: 1, totalProviders: 1 });
    expect(result.formulaVersion).toBe(AVS_FORMULA_VERSION);
  });

  // The evidence-traceability hard gate (epic DoD): the four returned
  // components, read back and combined under the documented weights, must
  // reproduce the returned composite exactly — for many different inputs,
  // not just one hand-picked example.
  it.each([
    { observations: SCENARIO_A, totalQueries: 2, totalProviders: 2 },
    { observations: [], totalQueries: 5, totalProviders: 4 },
    {
      observations: [
        { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.33 },
        { queryId: 'q2', brandMentioned: true, brandRecommended: true, brandFirstPosition: 0.66 },
        { queryId: 'q3', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
      ],
      totalQueries: 3,
      totalProviders: 3,
    },
  ])('breakdown sums to the stored total under the stated weights (%#)', (input) => {
    const result = computeAiVisibilityScore(input);
    const recombined =
      Math.round(
        (result.mentionScore * 0.25 + result.recommendationScore * 0.4 + result.positionScore * 0.2 + result.coverageScore * 0.15) *
          100,
      ) / 100;
    expect(recombined).toBe(result.aiVisibilityScore);
  });
});
