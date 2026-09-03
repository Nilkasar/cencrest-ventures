import { describe, expect, it } from 'vitest';
import { estimateAttribution, type AttributionInput } from './attribution.js';

function input(overrides: Partial<AttributionInput> = {}): AttributionInput {
  return {
    delta: 15,
    basis: 'geo',
    formulaVersionsMatch: true,
    otherActionsExecutedInWindow: 0,
    ...overrides,
  };
}

describe('estimateAttribution', () => {
  it('is a pure function: identical inputs always produce identical output', () => {
    const first = estimateAttribution(input());
    const second = estimateAttribution(input());
    expect(first).toEqual(second);
  });

  it('is low confidence with no assertion of change when delta is null (no comparable data)', () => {
    const result = estimateAttribution(input({ delta: null, basis: 'none', formulaVersionsMatch: null }));
    expect(result.confidence).toBe('low');
    expect(result.notes).not.toMatch(/proof|caused/i);
    expect(result.notes).toMatch(/not a claim that nothing changed/i);
  });

  it('is low confidence with no assertion of change when basis is none even if delta somehow is not null', () => {
    const result = estimateAttribution(input({ basis: 'none', delta: null }));
    expect(result.confidence).toBe('low');
  });

  it('never asserts certainty — no branch\'s notes contain "proof" without "not proof"/"an estimate"', () => {
    const scenarios: AttributionInput[] = [
      input({ delta: null, basis: 'none', formulaVersionsMatch: null }),
      input({ delta: 1, basis: 'geo' }),
      input({ delta: 20, basis: 'geo', otherActionsExecutedInWindow: 2 }),
      input({ delta: 20, basis: 'geo', formulaVersionsMatch: false }),
      input({ delta: 20, basis: 'geo' }),
      input({ delta: 6, basis: 'geo' }),
    ];
    for (const scenario of scenarios) {
      const { notes } = estimateAttribution(scenario);
      if (/proof/i.test(notes)) {
        expect(notes).toMatch(/not proof/i);
      }
      expect(notes).not.toMatch(/\bcaused by this action\b/i);
      expect(notes).not.toMatch(/\bconfirmed\b/i);
    }
  });

  it('caps confidence at medium when another action executed on the same brand in the window — confounded', () => {
    const result = estimateAttribution(input({ delta: 25, otherActionsExecutedInWindow: 1 }));
    expect(result.confidence).toBe('medium');
    expect(result.notes).toMatch(/other action/i);
  });

  it('caps confidence at medium with a plural note for more than one confounding action', () => {
    const result = estimateAttribution(input({ delta: 25, otherActionsExecutedInWindow: 3 }));
    expect(result.confidence).toBe('medium');
    expect(result.notes).toContain('3 other actions were');
  });

  it('is low confidence when the delta magnitude is small (plausible noise)', () => {
    const result = estimateAttribution(input({ delta: 1.5 }));
    expect(result.confidence).toBe('low');
    expect(result.notes).toMatch(/noise/i);
  });

  it('is low confidence for a delta of exactly 0 (stayed flat)', () => {
    const result = estimateAttribution(input({ delta: 0 }));
    expect(result.confidence).toBe('low');
    expect(result.notes).toMatch(/stayed flat/i);
  });

  it('caps confidence at medium when formula versions differ, even for a large delta', () => {
    const result = estimateAttribution(input({ delta: 25, formulaVersionsMatch: false }));
    expect(result.confidence).toBe('medium');
    expect(result.notes).toMatch(/formula/i);
  });

  it('is high confidence for a large, unconfounded, same-formula-version delta', () => {
    const result = estimateAttribution(input({ delta: 25, otherActionsExecutedInWindow: 0, formulaVersionsMatch: true }));
    expect(result.confidence).toBe('high');
    expect(result.notes).toMatch(/estimate, not proof/i);
  });

  it('is medium confidence for a moderate, unconfounded delta below the high-confidence threshold', () => {
    const result = estimateAttribution(input({ delta: 6 }));
    expect(result.confidence).toBe('medium');
  });

  it('labels the basis correctly in notes for SEO', () => {
    const result = estimateAttribution(input({ delta: 25, basis: 'seo' }));
    expect(result.notes).toMatch(/SEO score/);
    expect(result.notes).not.toMatch(/AI-visibility/);
  });

  it('labels the basis correctly in notes for GEO', () => {
    const result = estimateAttribution(input({ delta: 25, basis: 'geo' }));
    expect(result.notes).toMatch(/AI-visibility score/);
  });

  it('describes a decline correctly, not just improvements', () => {
    const result = estimateAttribution(input({ delta: -25 }));
    expect(result.confidence).toBe('high');
    expect(result.notes).toMatch(/declined by 25\.00 points/);
  });

  it('the noise threshold and significance threshold are both exercised at their real boundary', () => {
    // Just below the noise threshold (3) -> low.
    expect(estimateAttribution(input({ delta: 2.99 })).confidence).toBe('low');
    // At the noise threshold -> no longer noise, evaluated further (medium, below the high threshold).
    expect(estimateAttribution(input({ delta: 3 })).confidence).toBe('medium');
    // Just below the significant threshold (10) -> medium.
    expect(estimateAttribution(input({ delta: 9.99 })).confidence).toBe('medium');
    // At the significant threshold -> high.
    expect(estimateAttribution(input({ delta: 10 })).confidence).toBe('high');
  });
});
