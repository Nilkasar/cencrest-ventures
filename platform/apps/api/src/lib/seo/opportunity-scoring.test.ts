import { describe, expect, it } from 'vitest';
import { computeEffort, computeOpportunityScore, computeValue, SCORING_FORMULA_VERSION } from './opportunity-scoring.js';

// Every fixture here is hand-computed against formula v1.0
// (docs/10-seo/SEO_ENGINE.md, verbatim):
//   Value = demand_score × (1 - current_coverage)
//   Effort = (content_complexity × technical_difficulty) / 100   (see this
//     module's header comment #1 for why the /100 is there)
//   Opportunity Score = clamp(Value×0.7 + (Value/Effort)×0.3, 0, 100)
// This is the "deterministic unit tests against known fixture
// inputs/outputs" the epic's Definition of Done hard-requires.

describe('computeValue', () => {
  it('demand × (1 - coverage)', () => {
    expect(computeValue(80, 0.2)).toBe(64);
  });

  it('is 0 at full coverage regardless of demand', () => {
    expect(computeValue(100, 1)).toBe(0);
  });

  it('equals demand at zero coverage', () => {
    expect(computeValue(55, 0)).toBe(55);
  });
});

describe('computeEffort', () => {
  it('(complexity × difficulty) / 100', () => {
    expect(computeEffort(50, 40)).toBe(20);
  });

  it('is 0 when complexity is 0', () => {
    expect(computeEffort(0, 50)).toBe(0);
  });

  it('maxes at 100 when both inputs are 100', () => {
    expect(computeEffort(100, 100)).toBe(100);
  });
});

describe('computeOpportunityScore', () => {
  it('fixture 1 — mid-range demand, partial coverage, moderate effort', () => {
    const result = computeOpportunityScore({
      demandScore: 80,
      currentCoverage: 0.2,
      contentComplexity: 50,
      technicalDifficulty: 40,
    });
    expect(result).toEqual({
      valueScore: 64,
      effortScore: 20,
      opportunityScore: 45.76,
      formulaVersion: '1.0',
    });
  });

  it('fixture 2 — max demand/zero coverage, high effort', () => {
    const result = computeOpportunityScore({
      demandScore: 100,
      currentCoverage: 0,
      contentComplexity: 90,
      technicalDifficulty: 90,
    });
    expect(result.valueScore).toBe(100);
    expect(result.effortScore).toBe(81);
    expect(result.opportunityScore).toBe(70.37);
  });

  it('fixture 3 — zero effort clamps the score at 100, not Infinity/NaN', () => {
    const result = computeOpportunityScore({
      demandScore: 50,
      currentCoverage: 0.5,
      contentComplexity: 0,
      technicalDifficulty: 50,
    });
    expect(result.valueScore).toBe(25);
    // The stored effort score reflects the TRUE effort (0) — only the
    // internal division-safety floor is hidden from this value.
    expect(result.effortScore).toBe(0);
    expect(result.opportunityScore).toBe(100);
    expect(Number.isFinite(result.opportunityScore)).toBe(true);
  });

  it('fixture 4 — full coverage means zero opportunity regardless of effort', () => {
    const result = computeOpportunityScore({
      demandScore: 100,
      currentCoverage: 1,
      contentComplexity: 50,
      technicalDifficulty: 50,
    });
    expect(result).toEqual({
      valueScore: 0,
      effortScore: 25,
      opportunityScore: 0,
      formulaVersion: '1.0',
    });
  });

  it('fixture 5 — near-zero (but nonzero) effort still clamps to 100, not thousands', () => {
    const result = computeOpportunityScore({
      demandScore: 100,
      currentCoverage: 0,
      contentComplexity: 1,
      technicalDifficulty: 1,
    });
    expect(result.effortScore).toBe(0.01);
    expect(result.opportunityScore).toBe(100);
  });

  it('every result stays within the documented 0-100 range', () => {
    const cases = [
      { demandScore: 0, currentCoverage: 0, contentComplexity: 0, technicalDifficulty: 0 },
      { demandScore: 100, currentCoverage: 0, contentComplexity: 100, technicalDifficulty: 100 },
      { demandScore: 37, currentCoverage: 0.42, contentComplexity: 65, technicalDifficulty: 12 },
    ];
    for (const input of cases) {
      const result = computeOpportunityScore(input);
      expect(result.valueScore).toBeGreaterThanOrEqual(0);
      expect(result.valueScore).toBeLessThanOrEqual(100);
      expect(result.effortScore).toBeGreaterThanOrEqual(0);
      expect(result.effortScore).toBeLessThanOrEqual(100);
      expect(result.opportunityScore).toBeGreaterThanOrEqual(0);
      expect(result.opportunityScore).toBeLessThanOrEqual(100);
    }
  });

  it('stamps every result with the current formula version', () => {
    const result = computeOpportunityScore({
      demandScore: 10,
      currentCoverage: 0.1,
      contentComplexity: 10,
      technicalDifficulty: 10,
    });
    expect(result.formulaVersion).toBe(SCORING_FORMULA_VERSION);
  });
});
