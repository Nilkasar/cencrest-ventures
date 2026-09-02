import { describe, expect, it } from 'vitest';
import {
  buildOpportunityScoringInput,
  classifyOpportunityType,
  contentComplexityForIntent,
  normalizeDemandScore,
} from './keyword-to-opportunity.js';

describe('normalizeDemandScore', () => {
  it('divides by 10 and clamps at 100', () => {
    expect(normalizeDemandScore(1000)).toBe(100);
    expect(normalizeDemandScore(300)).toBe(30);
    expect(normalizeDemandScore(80)).toBe(8);
  });

  it('clamps a very large real-provider volume at 100', () => {
    expect(normalizeDemandScore(50000)).toBe(100);
  });

  it('defaults to 20 when volume is unknown', () => {
    expect(normalizeDemandScore(null)).toBe(20);
  });
});

describe('contentComplexityForIntent', () => {
  it('rates transactional/commercial intent as higher complexity', () => {
    expect(contentComplexityForIntent('transactional')).toBe(60);
    expect(contentComplexityForIntent('commercial')).toBe(60);
  });

  it('rates informational/navigational/null as lower complexity', () => {
    expect(contentComplexityForIntent('informational')).toBe(30);
    expect(contentComplexityForIntent('navigational')).toBe(30);
    expect(contentComplexityForIntent(null)).toBe(30);
  });
});

describe('classifyOpportunityType', () => {
  it('detects comparison phrasing regardless of intent', () => {
    expect(classifyOpportunityType('acme vs competitor', 'commercial')).toBe('comparison_page');
    expect(classifyOpportunityType('acme versus competitor', null)).toBe('comparison_page');
  });

  it('routes transactional/commercial (non-comparison) to service_page', () => {
    expect(classifyOpportunityType('buy freight visibility software', 'transactional')).toBe('service_page');
  });

  it('routes question-shaped informational keywords to faq_page', () => {
    expect(classifyOpportunityType('what is freight visibility', 'informational')).toBe('faq_page');
    expect(classifyOpportunityType('how do I track shipments', 'informational')).toBe('faq_page');
  });

  it('falls back to use_case_page', () => {
    expect(classifyOpportunityType('freight visibility for manufacturing', 'informational')).toBe('use_case_page');
  });
});

describe('buildOpportunityScoringInput', () => {
  it('assembles the four formula inputs from a keyword row', () => {
    expect(
      buildOpportunityScoringInput({ text: 'best crm software', monthlyVolume: 300, difficulty: 40, intent: 'commercial' }),
    ).toEqual({
      demandScore: 30,
      currentCoverage: 0,
      contentComplexity: 60,
      technicalDifficulty: 40,
    });
  });

  it('falls back to the neutral difficulty default when unknown', () => {
    const input = buildOpportunityScoringInput({ text: 'crm', monthlyVolume: null, difficulty: null, intent: null });
    expect(input.technicalDifficulty).toBe(50);
    expect(input.currentCoverage).toBe(0);
  });
});
