import { describe, expect, it } from 'vitest';
import {
  actionTypeForOpportunityType,
  computePriorityRank,
  descriptionForRecommendation,
  evidenceSummaryForRecommendation,
  implementationNotesForRecommendation,
  levelFromScore,
  titleForRecommendation,
  topCompetitorName,
  type EvidenceRow,
} from './generator.js';
import type { recommendation_action_type, unified_opportunity_type } from '@bebest/database';

const ALL_ACTION_TYPES: recommendation_action_type[] = ['create_page', 'update_page', 'fix_technical', 'build_citations'];

describe('actionTypeForOpportunityType', () => {
  it('is total over every unified_opportunity_type value', () => {
    const types: unified_opportunity_type[] = ['seo', 'geo', 'unified', 'content', 'technical'];
    for (const t of types) {
      expect(() => actionTypeForOpportunityType(t)).not.toThrow();
    }
  });

  it('maps seo and unified to create_page (Epic 9 always models currentCoverage: 0 — no existing page)', () => {
    expect(actionTypeForOpportunityType('seo')).toBe('create_page');
    expect(actionTypeForOpportunityType('unified')).toBe('create_page');
  });

  it('maps geo to build_citations (pure GEO gap, no SEO signal alongside it)', () => {
    expect(actionTypeForOpportunityType('geo')).toBe('build_citations');
  });

  it('maps the forward-reserved content/technical types to update_page/fix_technical', () => {
    expect(actionTypeForOpportunityType('content')).toBe('update_page');
    expect(actionTypeForOpportunityType('technical')).toBe('fix_technical');
  });

  it('every one of the 4 recommendation_action_type values is reachable from some opportunity type', () => {
    const types: unified_opportunity_type[] = ['seo', 'geo', 'unified', 'content', 'technical'];
    const reached = new Set(types.map(actionTypeForOpportunityType));
    for (const a of ALL_ACTION_TYPES) expect(reached.has(a)).toBe(true);
  });
});

describe('levelFromScore', () => {
  it('buckets 0-100 into low/medium/high using the 30/60 thresholds', () => {
    expect(levelFromScore(0)).toBe('low');
    expect(levelFromScore(29.99)).toBe('low');
    expect(levelFromScore(30)).toBe('medium');
    expect(levelFromScore(59.99)).toBe('medium');
    expect(levelFromScore(60)).toBe('high');
    expect(levelFromScore(100)).toBe('high');
  });
});

describe('computePriorityRank', () => {
  it('a low-effort recommendation keeps the full opportunity_score', () => {
    expect(computePriorityRank(80, 'low')).toBe(80);
  });

  it('cheap (low-effort), high-impact recommendations rank above expensive (high-effort) ones at the SAME opportunity_score', () => {
    const cheap = computePriorityRank(80, 'low');
    const expensive = computePriorityRank(80, 'high');
    expect(cheap).toBeGreaterThan(expensive);
  });

  it('a low-effort recommendation from a lower-scored opportunity can still beat a high-effort one from a higher-scored opportunity', () => {
    const lowEffortLowerScore = computePriorityRank(70, 'low'); // 70
    const highEffortHigherScore = computePriorityRank(90, 'high'); // 45
    expect(lowEffortLowerScore).toBeGreaterThan(highEffortHigherScore);
  });
});

describe('topCompetitorName', () => {
  it('returns null when there is no ai_runs evidence', () => {
    const evidence: EvidenceRow[] = [{ sourceTable: 'seo_keywords', summary: 'x', rawData: { keywordId: 'k1' } }];
    expect(topCompetitorName(evidence)).toBeNull();
  });

  it('returns the competitor with the highest mention rate across multiple ai_runs rows', () => {
    const evidence: EvidenceRow[] = [
      { sourceTable: 'ai_runs', summary: 'a', rawData: { competitorName: 'CompetitorA', competitorMentionRatePct: 40 } },
      { sourceTable: 'ai_runs', summary: 'b', rawData: { competitorName: 'CompetitorB', competitorMentionRatePct: 84 } },
    ];
    expect(topCompetitorName(evidence)).toBe('CompetitorB');
  });
});

describe('title/description templates — reference real per-opportunity data, not a generic string', () => {
  it('create_page WITH a competitor reproduces the spec\'s literal "comparison page" example', () => {
    const ctx = { actionType: 'create_page' as const, intentText: 'managed X hosting', brandName: 'Acme', competitorName: 'CompetitorA' };
    expect(titleForRecommendation(ctx)).toBe('Build a comparison page: Acme vs CompetitorA for managed X hosting');
  });

  it('create_page with NO competitor (pure SEO) falls back to a plain build-a-page title', () => {
    const ctx = { actionType: 'create_page' as const, intentText: 'managed X hosting', brandName: 'Acme', competitorName: null };
    expect(titleForRecommendation(ctx)).toContain('managed X hosting');
    expect(titleForRecommendation(ctx)).not.toContain('vs');
  });

  it('every action_type produces a non-empty, distinct title and description', () => {
    const titles = new Set<string>();
    for (const actionType of ALL_ACTION_TYPES) {
      const ctx = { actionType, intentText: 'best freight visibility software', brandName: 'Acme', competitorName: 'CompetitorA' };
      const title = titleForRecommendation(ctx);
      const description = descriptionForRecommendation(ctx);
      expect(title.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
      expect(description).toContain('best freight visibility software');
      titles.add(title);
    }
    expect(titles.size).toBe(ALL_ACTION_TYPES.length);
  });
});

describe('evidenceSummaryForRecommendation — quotes the REAL opportunity_evidence numbers', () => {
  it('interpolates the exact evidence sentences verbatim, not a generic template string', () => {
    const evidence: EvidenceRow[] = [
      { sourceTable: 'seo_keywords', summary: '"best freight visibility software" gets an estimated 500 monthly searches.', rawData: null },
      { sourceTable: 'ai_runs', summary: 'CompetitorA appears in 84% of responses at position 1, you appear in 0% of responses.', rawData: null },
    ];
    const summary = evidenceSummaryForRecommendation(65.5, 1, evidence);
    expect(summary).toContain('500 monthly searches');
    expect(summary).toContain('84% of responses');
    expect(summary).toContain('65.5/100');
  });
});

describe('implementationNotesForRecommendation — DoD: BOTH an SEO and a GEO requirement, for EVERY action_type', () => {
  it.each(ALL_ACTION_TYPES)('%s includes a distinct SEO requirement and a distinct GEO requirement', (actionType) => {
    const notes = implementationNotesForRecommendation(actionType, 'best freight visibility software', 'CompetitorA');
    expect(notes).toMatch(/SEO requirements:/);
    expect(notes).toMatch(/GEO requirements:/);
    // The SEO half must actually cite Epic 4's checklist vocabulary, not a
    // generic placeholder.
    expect(notes).toMatch(/checklist|title tag|meta description|H1|canonical|alt text|HTTPS/i);
    // The GEO half must actually cite GEO_ENGINE.md's principle vocabulary.
    expect(notes).toMatch(/citable|FAQ|server-rendered|entity association|G2|benchmark/i);
  });

  it('every action_type gets a DIFFERENT SEO requirement and a DIFFERENT GEO requirement (not one copy-pasted block)', () => {
    const seoHalves = new Set<string>();
    const geoHalves = new Set<string>();
    for (const actionType of ALL_ACTION_TYPES) {
      const notes = implementationNotesForRecommendation(actionType, 'x', null);
      const [seoHalf, geoHalf] = notes.split('\n\n');
      seoHalves.add(seoHalf!);
      geoHalves.add(geoHalf!);
    }
    expect(seoHalves.size).toBe(ALL_ACTION_TYPES.length);
    expect(geoHalves.size).toBe(ALL_ACTION_TYPES.length);
  });
});
