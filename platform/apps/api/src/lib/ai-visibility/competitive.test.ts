import { describe, expect, it } from 'vitest';
import {
  buildQueryComparisonSentence,
  classifyContentGaps,
  classifyEntityGaps,
  classifyIntentGaps,
  classifySourceGaps,
  computeCompetitiveGap,
  computeCompetitorMovement,
  computePerIntentTypeGaps,
  computeQueryStats,
  computeShareOfAiVoice,
  positionBucket,
  type QueryComparisonInput,
} from './competitive.js';
import type { ScoredObservation } from './scoring.js';

// ── Share of AI Voice — the DoD's explicit boundary requirement ──────────
describe('computeShareOfAiVoice', () => {
  it('is a sane 0%, never NaN/Infinity, when nobody was mentioned at all (0/0)', () => {
    const result = computeShareOfAiVoice(0, { compA: 0, compB: 0 });
    expect(result.totalMentions).toBe(0);
    expect(result.yourSharePct).toBe(0);
    expect(Number.isNaN(result.yourSharePct)).toBe(false);
    expect(result.competitorShares).toEqual({ compA: 0, compB: 0 });
  });

  it('gives the brand exactly 100% when competitors have zero mentions', () => {
    const result = computeShareOfAiVoice(12, { compA: 0 });
    expect(result.yourSharePct).toBe(100);
    expect(result.competitorShares.compA).toBe(0);
    expect(result.totalMentions).toBe(12);
  });

  it('gives competitors 100% (brand 0%) when the brand has zero mentions but competitors have some', () => {
    const result = computeShareOfAiVoice(0, { compA: 8 });
    expect(result.yourSharePct).toBe(0);
    expect(result.competitorShares.compA).toBe(100);
  });

  it('computes correctly for a single tracked competitor (the general case, not a special one)', () => {
    const result = computeShareOfAiVoice(10, { compA: 30 });
    // 10 / (10+30) * 100 = 25
    expect(result.yourSharePct).toBe(25);
    expect(result.competitorShares.compA).toBe(75);
    expect(result.yourSharePct + result.competitorShares.compA!).toBe(100);
  });

  it('sums to 100 across the brand and every competitor for the general multi-competitor case', () => {
    const result = computeShareOfAiVoice(20, { a: 10, b: 30, c: 40 });
    const total = result.yourSharePct + Object.values(result.competitorShares).reduce((s, n) => s + n, 0);
    expect(total).toBeCloseTo(100, 5);
  });
});

// ── Competitive Gap ────────────────────────────────────────────────────
describe('computeCompetitiveGap', () => {
  it('is competitor AVS minus your AVS', () => {
    expect(computeCompetitiveGap(45.2, 30.1)).toBeCloseTo(15.1, 5);
  });

  it('is negative when the brand outperforms the competitor', () => {
    expect(computeCompetitiveGap(20, 50)).toBe(-30);
  });

  it('is null when either side has not computed a score yet (not treated as zero)', () => {
    expect(computeCompetitiveGap(null, 30)).toBeNull();
    expect(computeCompetitiveGap(30, null)).toBeNull();
    expect(computeCompetitiveGap(null, null)).toBeNull();
  });
});

// ── Per-intent-type gap ────────────────────────────────────────────────
describe('computePerIntentTypeGaps', () => {
  const queries = [
    { id: 'q1', intentType: 'commercial' },
    { id: 'q2', intentType: 'commercial' },
    { id: 'q3', intentType: 'informational' },
    { id: 'q4', intentType: null },
  ];

  function obs(queryId: string, mentioned: boolean): ScoredObservation {
    return { queryId, brandMentioned: mentioned, brandRecommended: false, brandFirstPosition: mentioned ? 0.1 : null };
  }

  it('groups by intent_type, buckets null under "uncategorized", and computes an independent gap per group', () => {
    const yours: ScoredObservation[] = [obs('q1', false), obs('q2', false), obs('q3', true), obs('q4', false)];
    const competitor: ScoredObservation[] = [obs('q1', true), obs('q2', true), obs('q3', true), obs('q4', true)];

    const gaps = computePerIntentTypeGaps(queries, yours, 1, competitor, 1);

    const commercial = gaps.find((g) => g.intentType === 'commercial')!;
    const informational = gaps.find((g) => g.intentType === 'informational')!;
    const uncategorized = gaps.find((g) => g.intentType === 'uncategorized')!;

    expect(commercial.queryCount).toBe(2);
    expect(commercial.gap).toBeGreaterThan(0); // competitor mentioned both, brand mentioned neither
    expect(informational.gap).toBe(0); // both mentioned q3
    expect(uncategorized.queryCount).toBe(1);
  });
});

// ── positionBucket / computeQueryStats ─────────────────────────────────
describe('positionBucket', () => {
  it('buckets the normalized 0..1 offset into quartile positions 1-4', () => {
    expect(positionBucket(0)).toBe(1);
    expect(positionBucket(0.25)).toBe(1);
    expect(positionBucket(0.26)).toBe(2);
    expect(positionBucket(0.5)).toBe(2);
    expect(positionBucket(0.51)).toBe(3);
    expect(positionBucket(0.75)).toBe(3);
    expect(positionBucket(0.76)).toBe(4);
    expect(positionBucket(1)).toBe(4);
  });
});

describe('computeQueryStats', () => {
  it('computes a whole-percent mention rate over the total provider count, and the best (earliest) position', () => {
    const observations: ScoredObservation[] = [
      { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.6 },
      { queryId: 'q1', brandMentioned: true, brandRecommended: false, brandFirstPosition: 0.1 },
      { queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
      { queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null },
    ];
    const stats = computeQueryStats(observations, 4);
    expect(stats.mentionRatePct).toBe(50);
    expect(stats.position).toBe(1); // best of 0.6 and 0.1 is 0.1 -> quartile 1
  });

  it('returns null position (never a fabricated one) when nothing mentioned the entity', () => {
    const observations: ScoredObservation[] = [{ queryId: 'q1', brandMentioned: false, brandRecommended: false, brandFirstPosition: null }];
    const stats = computeQueryStats(observations, 1);
    expect(stats.mentionRatePct).toBe(0);
    expect(stats.position).toBeNull();
  });

  it('is 0%, not NaN, when the run had zero providers', () => {
    expect(computeQueryStats([], 0).mentionRatePct).toBe(0);
  });
});

// ── The signature evidence sentence ────────────────────────────────────
describe('buildQueryComparisonSentence', () => {
  it('matches the spec\'s exact evidence format', () => {
    const sentence = buildQueryComparisonSentence({
      queryText: 'best freight visibility software',
      competitorName: 'CompetitorA',
      competitorStats: { mentionRatePct: 84, position: 1 },
      yourStats: { mentionRatePct: 2, position: null },
    });
    expect(sentence).toBe(
      'For "best freight visibility software," CompetitorA appears in 84% of responses at position 1, you appear in 2% of responses.',
    );
  });

  it('omits the "at position N" clause (never fabricates one) when a side was never mentioned', () => {
    const sentence = buildQueryComparisonSentence({
      queryText: 'x',
      competitorName: 'CompetitorA',
      competitorStats: { mentionRatePct: 0, position: null },
      yourStats: { mentionRatePct: 0, position: null },
    });
    expect(sentence).toBe('For "x," CompetitorA appears in 0% of responses, you appear in 0% of responses.');
  });
});

// ── Gap classification — all four types independently identifiable ─────
describe('gap classification', () => {
  function row(overrides: Partial<QueryComparisonInput>): QueryComparisonInput {
    return {
      queryId: 'q1',
      queryText: 'best freight visibility software',
      category: 'category',
      yourStats: { mentionRatePct: 0, position: null },
      yourCitedDomains: [],
      competitors: [],
      ...overrides,
    };
  }

  it('classifyIntentGaps: flags a query where a competitor appears and the brand does not, severity high at >=50%', () => {
    const rows = [
      row({
        queryId: 'q1',
        yourStats: { mentionRatePct: 0, position: null },
        competitors: [{ competitorId: 'c1', competitorName: 'CompetitorA', stats: { mentionRatePct: 90, position: 1 }, citedDomains: [] }],
      }),
    ];
    const gaps = classifyIntentGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapType).toBe('intent_gap');
    expect(gaps[0]!.severity).toBe('high');
    expect(gaps[0]!.competitors[0]!.competitorName).toBe('CompetitorA');
  });

  it('classifyIntentGaps: no finding when the brand has ANY presence', () => {
    const rows = [
      row({
        yourStats: { mentionRatePct: 5, position: 4 },
        competitors: [{ competitorId: 'c1', competitorName: 'CompetitorA', stats: { mentionRatePct: 90, position: 1 }, citedDomains: [] }],
      }),
    ];
    expect(classifyIntentGaps(rows)).toHaveLength(0);
  });

  it('classifyContentGaps: flags a query where competitors cite sources and the brand cites none and is weakly present', () => {
    const rows = [
      row({
        yourStats: { mentionRatePct: 10, position: 4 },
        yourCitedDomains: [],
        competitors: [{ competitorId: 'c1', competitorName: 'CompetitorA', stats: { mentionRatePct: 90, position: 1 }, citedDomains: ['g2.com'] }],
      }),
    ];
    const gaps = classifyContentGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapType).toBe('content_gap');
    expect(gaps[0]!.citedDomains).toEqual(['g2.com']);
  });

  it('classifyEntityGaps: flags a whole category where the brand has 0% presence across every query in it', () => {
    const rows = [
      row({ queryId: 'q1', category: 'industry', yourStats: { mentionRatePct: 0, position: null }, competitors: [{ competitorId: 'c1', competitorName: 'CompetitorA', stats: { mentionRatePct: 80, position: 1 }, citedDomains: [] }] }),
      row({ queryId: 'q2', category: 'industry', yourStats: { mentionRatePct: 0, position: null }, competitors: [{ competitorId: 'c1', competitorName: 'CompetitorA', stats: { mentionRatePct: 60, position: 2 }, citedDomains: [] }] }),
    ];
    const gaps = classifyEntityGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapType).toBe('entity_gap');
    expect(gaps[0]!.category).toBe('industry');
    expect(gaps[0]!.yourPresencePct).toBe(0);
    expect(gaps[0]!.competitors[0]!.presencePct).toBe(100);
  });

  it('classifyEntityGaps: no finding once the brand has presence anywhere in the category', () => {
    const rows = [
      row({ queryId: 'q1', category: 'industry', yourStats: { mentionRatePct: 40, position: 2 } }),
      row({ queryId: 'q2', category: 'industry', yourStats: { mentionRatePct: 0, position: null } }),
    ];
    expect(classifyEntityGaps(rows)).toHaveLength(0);
  });

  it('classifySourceGaps: flags a domain competitors cite that the brand never cites', () => {
    const gaps = classifySourceGaps(['brand-owned.com'], [
      { competitorId: 'c1', competitorName: 'CompetitorA', citedDomains: ['g2.com', 'g2.com', 'brand-owned.com'], totalJobs: 4 },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapType).toBe('source_gap');
    expect(gaps[0]!.domain).toBe('g2.com');
    expect(gaps[0]!.citedByCompetitors[0]!.citationRatePct).toBe(50); // 2/4
  });

  it('classifySourceGaps: no finding for a domain the brand also gets cited on', () => {
    const gaps = classifySourceGaps(['g2.com'], [{ competitorId: 'c1', competitorName: 'CompetitorA', citedDomains: ['g2.com'], totalJobs: 4 }]);
    expect(gaps).toHaveLength(0);
  });

  it('every gap finding carries an explicit gapType field distinguishing all four types', () => {
    const types = new Set(
      [
        ...classifyIntentGaps([row({ competitors: [{ competitorId: 'c1', competitorName: 'A', stats: { mentionRatePct: 60, position: 1 }, citedDomains: [] }] })]),
        ...classifyContentGaps([row({ yourStats: { mentionRatePct: 0, position: null }, competitors: [{ competitorId: 'c1', competitorName: 'A', stats: { mentionRatePct: 60, position: 1 }, citedDomains: ['g2.com'] }] })]),
        ...classifyEntityGaps([row({ competitors: [{ competitorId: 'c1', competitorName: 'A', stats: { mentionRatePct: 60, position: 1 }, citedDomains: [] }] })]),
        ...classifySourceGaps([], [{ competitorId: 'c1', competitorName: 'A', citedDomains: ['x.com'], totalJobs: 1 }]),
      ].map((g) => g.gapType),
    );
    expect(types).toEqual(new Set(['intent_gap', 'content_gap', 'entity_gap', 'source_gap']));
  });
});

// ── Movement alerts (comparison logic only) ────────────────────────────
describe('computeCompetitorMovement', () => {
  it('reports an increase with the retention-mechanic sentence shape', () => {
    const result = computeCompetitorMovement('CompetitorA', 30, 45);
    expect(result.delta).toBe(15);
    expect(result.direction).toBe('increase');
    expect(result.sentence).toBe('CompetitorA just increased their AI visibility by 15 points.');
  });

  it('reports a decrease', () => {
    const result = computeCompetitorMovement('CompetitorA', 45, 30);
    expect(result.delta).toBe(-15);
    expect(result.direction).toBe('decrease');
    expect(result.sentence).toBe('CompetitorA just decreased their AI visibility by 15 points.');
  });

  it('is null/flat (never a fabricated delta) when there is no previous run to compare against', () => {
    const result = computeCompetitorMovement('CompetitorA', null, 45);
    expect(result.delta).toBeNull();
    expect(result.direction).toBeNull();
    expect(result.sentence).toBeNull();
  });
});
