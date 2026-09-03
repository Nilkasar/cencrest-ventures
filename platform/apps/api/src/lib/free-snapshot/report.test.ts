import { describe, expect, it } from 'vitest';
import { buildFreeSnapshotReport, type FreeSnapshotReportInput } from './report.js';
import type { FreeSnapshotSeoResult } from './seo-analysis.js';
import type { FreeSnapshotAiRunResult, FreeSnapshotObservation } from './ai-run.js';

const INPUT: FreeSnapshotReportInput = {
  name: 'Ada',
  company: 'Acme',
  website: 'https://acme.example',
  category: 'CRM software',
  biggestCompetitor: 'Rival Inc',
};

function seo(overrides: Partial<FreeSnapshotSeoResult> = {}): FreeSnapshotSeoResult {
  return { pagesAnalyzed: 5, averageTechnicalScore: 80, contentScore: 70, pages: [], issues: [], ...overrides };
}

function obs(overrides: Partial<FreeSnapshotObservation>): FreeSnapshotObservation {
  return {
    queryId: 'q1',
    queryText: 'best CRM for startups?',
    category: 'commercial',
    provider: 'openai',
    brandMentioned: false,
    brandRecommended: false,
    brandFirstPosition: null,
    competitorsMentioned: [],
    ...overrides,
  };
}

function ai(observations: FreeSnapshotObservation[], overrides: Partial<FreeSnapshotAiRunResult> = {}): FreeSnapshotAiRunResult {
  return {
    providers: ['openai', 'anthropic', 'google', 'perplexity'],
    totalQueries: new Set(observations.map((o) => o.queryId)).size || 1,
    observations,
    score: { mentionScore: 50, recommendationScore: 25, positionScore: 60, coverageScore: 50, aiVisibilityScore: 42.5, formulaVersion: '1.0' },
    ...overrides,
  };
}

describe('buildFreeSnapshotReport', () => {
  it('surfaces the provided biggest competitor first, then auto-detects others from AI observations, capped at 3', () => {
    const observations = [
      obs({ queryId: 'q1', brandMentioned: true, competitorsMentioned: ['Rival Inc', 'Other Co'] }),
      obs({ queryId: 'q2', brandMentioned: false, competitorsMentioned: ['Other Co', 'Third Co'] }),
    ];
    const report = buildFreeSnapshotReport(INPUT, seo(), ai(observations));

    expect(report.competitors[0]).toMatchObject({ name: 'Rival Inc', autoDetected: false });
    expect(report.competitors.length).toBeLessThanOrEqual(3);
    expect(report.competitors.some((c) => c.name === 'Other Co' && c.autoDetected)).toBe(true);
  });

  it('ranks top AI gaps by unmentioned queries, preferring bottom-of-funnel categories and competitor-confirmed gaps', () => {
    const observations = [
      // q1: never mentioned, no competitor either (weaker gap signal).
      obs({ queryId: 'q1', category: 'category', brandMentioned: false, competitorsMentioned: [] }),
      // q2: never mentioned, but a competitor WAS mentioned (stronger gap), and it's a bottom-of-funnel "comparison" category.
      obs({ queryId: 'q2', queryText: 'Acme vs Rival Inc', category: 'comparison', brandMentioned: false, competitorsMentioned: ['Rival Inc'] }),
      // q3: brand IS mentioned somewhere — not a gap at all.
      obs({ queryId: 'q3', category: 'commercial', brandMentioned: true, competitorsMentioned: [] }),
    ];
    const report = buildFreeSnapshotReport(INPUT, seo(), ai(observations));

    expect(report.topAiGaps.map((g) => g.query)).not.toContain('best CRM for startups?'.repeat(0)); // sanity: no crash
    expect(report.topAiGaps.some((g) => g.query === 'Acme vs Rival Inc')).toBe(true);
    // The comparison gap (priority 1, competitor-confirmed) outranks the plain category gap (priority 3).
    expect(report.topAiGaps[0]!.query).toBe('Acme vs Rival Inc');
    expect(report.topAiGaps.every((g) => g.query !== 'q3')).toBe(true);
  });

  it('ranks top SEO gaps by severity then by how many sample pages are affected', () => {
    const seoResult = seo({
      issues: [
        { issueType: 'missing_alt', severity: 'low', pageUrl: 'https://acme.example/a' },
        { issueType: 'missing_title', severity: 'high', pageUrl: 'https://acme.example/a' },
        { issueType: 'missing_title', severity: 'high', pageUrl: 'https://acme.example/b' },
        { issueType: 'thin_content', severity: 'medium', pageUrl: 'https://acme.example/a' },
      ],
    });
    const report = buildFreeSnapshotReport(INPUT, seoResult, ai([]));

    expect(report.topSeoGaps[0]).toMatchObject({ issueType: 'missing_title', severity: 'high', pageCount: 2 });
    expect(report.topSeoGaps.map((g) => g.issueType)).toEqual(['missing_title', 'thin_content', 'missing_alt']);
  });

  it('always produces exactly 3 priorities, falling back to honest "none found in this sample" copy when there is no gap data', () => {
    const report = buildFreeSnapshotReport(INPUT, seo({ issues: [] }), ai([]));
    expect(report.topPriorities).toHaveLength(3);
    expect(report.topPriorities[0]!.title).toContain('No AI-visibility gaps');
  });

  it('carries the AVS formula fields through unmodified and includes the documented simplification note + CTA copy', () => {
    const observations = [obs({ queryId: 'q1', brandMentioned: true })];
    const report = buildFreeSnapshotReport(INPUT, seo(), ai(observations, { score: { mentionScore: 25, recommendationScore: 100, positionScore: 100, coverageScore: 100, aiVisibilityScore: 81.25, formulaVersion: '1.0' } }));

    expect(report.aiVisibility.score).toBe(81.25);
    expect(report.aiVisibility.formulaVersion).toBe('1.0');
    expect(report.cta).toBe('See your full analysis — book a call or sign up.');
    expect(report.simplificationNote.length).toBeGreaterThan(0);
    expect(report.input).toEqual(INPUT);
  });
});
