import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── A small, generic in-memory Prisma-shaped query mock — good enough for
// this file's `gte`/`lte`/`lt` date-range filters, `orderBy` (asc/desc,
// single or array of clauses), and `distinct` (first row per key, in
// orderBy order) without pulling in a real query engine. ──────────────────
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    const ops = expected as Record<string, unknown>;
    if ('gte' in ops && !((actual as Date).getTime() >= (ops.gte as Date).getTime())) return false;
    if ('lte' in ops && !((actual as Date).getTime() <= (ops.lte as Date).getTime())) return false;
    if ('lt' in ops && !((actual as Date).getTime() < (ops.lt as Date).getTime())) return false;
    if ('gt' in ops && !((actual as Date).getTime() > (ops.gt as Date).getTime())) return false;
    return true;
  }
  return actual === expected;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === undefined ? true : matchesValue(row[key], value)));
}

function applyOrder(rows: Record<string, unknown>[], orderBy: unknown): Record<string, unknown>[] {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (clauses.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const clause of clauses as Array<Record<string, 'asc' | 'desc'>>) {
      const [field, dir] = Object.entries(clause)[0]!;
      const av = a[field] as Date | number;
      const bv = b[field] as Date | number;
      const an = av instanceof Date ? av.getTime() : av;
      const bn = bv instanceof Date ? bv.getTime() : bv;
      if (an !== bn) return dir === 'asc' ? (an < bn ? -1 : 1) : an < bn ? 1 : -1;
    }
    return 0;
  });
}

function findMany(
  rows: Record<string, unknown>[],
  args: { where?: Record<string, unknown>; orderBy?: unknown; distinct?: string[] },
): Record<string, unknown>[] {
  let result = args.where ? rows.filter((r) => matches(r, args.where!)) : [...rows];
  result = applyOrder(result, args.orderBy);
  if (args.distinct) {
    const seen = new Set<unknown>();
    result = result.filter((r) => {
      const key = args.distinct!.map((f) => r[f]).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return result;
}

function findFirst(rows: Record<string, unknown>[], args: { where?: Record<string, unknown>; orderBy?: unknown }): Record<string, unknown> | null {
  return findMany(rows, args)[0] ?? null;
}

let aiRunRows: Record<string, unknown>[] = [];
let seoAnalysisRows: Record<string, unknown>[] = [];
let measurementRows: Record<string, unknown>[] = [];
let opportunityRows: Record<string, unknown>[] = [];
let competitorRows: Record<string, unknown>[] = [];
let reportCreateCalls: Array<{ data: Record<string, unknown> }> = [];

const db = {
  ai_runs: { findFirst: vi.fn((args: unknown) => findFirst(aiRunRows, args as never)) },
  seo_analyses: { findMany: vi.fn((args: unknown) => findMany(seoAnalysisRows, args as never)), findFirst: vi.fn((args: unknown) => findFirst(seoAnalysisRows, args as never)) },
  measurements: { findMany: vi.fn((args: unknown) => findMany(measurementRows, args as never)) },
  unified_opportunities: { findMany: vi.fn((args: unknown) => findMany(opportunityRows, args as never)) },
  competitors: { findMany: vi.fn((args: unknown) => findMany(competitorRows, args as never)) },
  reports: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      reportCreateCalls.push({ data });
      return { id: 'report-1', ...data };
    }),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};
const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db, // `lib/audit.ts`'s `writeAuditEvent` calls `db.audit_events.create` directly (not via withOrgContext) — must be the same object this file asserts against.
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

const ORG = 'org-1';
const BRAND = 'brand-1';

function geoRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `run-${Math.random()}`,
    organization_id: ORG,
    brand_id: BRAND,
    competitor_id: null,
    status: 'completed',
    ai_visibility_score: '50.00',
    mention_score: '50.00',
    recommendation_score: '50.00',
    position_score: '50.00',
    coverage_score: '50.00',
    scoring_formula_version: '1.0',
    completed_at: new Date('2026-01-15T00:00:00.000Z'),
    created_at: new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  aiRunRows = [];
  seoAnalysisRows = [];
  measurementRows = [];
  opportunityRows = [];
  competitorRows = [];
  reportCreateCalls = [];
});

describe('generateReport — weekly/monthly/custom (shared section assembly)', () => {
  it('includes only measurements/opportunities measured/created WITHIN the period', async () => {
    measurementRows = [
      { id: 'm-in', organization_id: ORG, brand_id: BRAND, measured_at: new Date('2026-01-05T00:00:00.000Z'), score_delta: '5.00', attribution_confidence: 'high', attribution_notes: 'n', before_score: {}, after_score: {}, action_id: 'a1', created_at: new Date() },
      { id: 'm-out', organization_id: ORG, brand_id: BRAND, measured_at: new Date('2025-12-01T00:00:00.000Z'), score_delta: '1.00', attribution_confidence: 'low', attribution_notes: 'n', before_score: {}, after_score: {}, action_id: 'a2', created_at: new Date() },
    ];
    opportunityRows = [
      { id: 'o-in', organization_id: ORG, brand_id: BRAND, created_at: new Date('2026-01-06T00:00:00.000Z'), query_id: 'q1', intent_text: 't', type: 'seo', seo_demand_score: '10', geo_gap_score: null, effort_score: '1', impact_score: '1', opportunity_score: '10', scoring_formula_version: '1.0', status: 'new', priority: 1, dismissal_reason: null, title: 'x', updated_at: new Date() },
      { id: 'o-out', organization_id: ORG, brand_id: BRAND, created_at: new Date('2025-11-01T00:00:00.000Z'), query_id: 'q2', intent_text: 't', type: 'seo', seo_demand_score: '10', geo_gap_score: null, effort_score: '1', impact_score: '1', opportunity_score: '10', scoring_formula_version: '1.0', status: 'new', priority: 1, dismissal_reason: null, title: 'x', updated_at: new Date() },
    ];

    const { generateReport } = await import('./generate-report.js');
    const row = await generateReport({
      organizationId: ORG,
      brandId: BRAND,
      type: 'weekly',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-01-08T00:00:00.000Z'),
      createdBy: 'user-1',
    });

    const content = row.content as unknown as { scoreDeltas: Array<{ id: string }>; newOpportunities: Array<{ id: string }> };
    expect(content.scoreDeltas.map((m) => m.id)).toEqual(['m-in']);
    expect(content.newOpportunities.map((o) => o.id)).toEqual(['o-in']);
  });

  it('computes real competitor movement via Epic 8\'s computeCompetitorMovement, comparing before/after-period runs', async () => {
    competitorRows = [{ id: 'comp-1', organization_id: ORG, brand_id: BRAND, name: 'CompetitorA', deleted_at: null }];
    aiRunRows = [
      geoRun({ id: 'run-before', competitor_id: 'comp-1', ai_visibility_score: '40.00', completed_at: new Date('2025-12-01T00:00:00.000Z') }),
      geoRun({ id: 'run-after', competitor_id: 'comp-1', ai_visibility_score: '55.00', completed_at: new Date('2026-01-05T00:00:00.000Z') }),
    ];

    const { generateReport } = await import('./generate-report.js');
    const row = await generateReport({
      organizationId: ORG,
      brandId: BRAND,
      type: 'weekly',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-01-08T00:00:00.000Z'),
      createdBy: 'user-1',
    });

    const content = row.content as unknown as { competitorMovements: Array<{ competitorName: string; delta: number; direction: string; sentence: string }> };
    expect(content.competitorMovements).toHaveLength(1);
    expect(content.competitorMovements[0]).toMatchObject({ competitorName: 'CompetitorA', delta: 15, direction: 'increase' });
    expect(content.competitorMovements[0]!.sentence).toContain('CompetitorA');
  });

  it('monthly defaults to a 30-day period when none is given', async () => {
    const { generateReport } = await import('./generate-report.js');
    const periodEnd = new Date('2026-02-01T00:00:00.000Z');
    const row = await generateReport({ organizationId: ORG, brandId: BRAND, type: 'monthly', periodEnd, createdBy: 'user-1' });

    const content = row.content as unknown as { periodStart: string; periodEnd: string };
    expect(new Date(content.periodEnd).getTime()).toBe(periodEnd.getTime());
    expect(new Date(content.periodStart).getTime()).toBe(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  });

  it('persists the row with status completed, format json (PDF export not implemented), and writes a report.generated audit event', async () => {
    const { generateReport } = await import('./generate-report.js');
    await generateReport({ organizationId: ORG, brandId: BRAND, type: 'custom', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-02'), createdBy: 'user-1' });

    expect(reportCreateCalls).toHaveLength(1);
    expect(reportCreateCalls[0]!.data).toMatchObject({ organization_id: ORG, brand_id: BRAND, type: 'custom', status: 'completed', format: 'json' });
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'report.generated', result: 'success' }) }),
    );
  });
});

describe('generateReport — baseline_comparison', () => {
  it('compares the EARLIEST completed run (baseline) against the current snapshot, via Epic 14\'s real computeScoreDelta', async () => {
    aiRunRows = [
      geoRun({ id: 'run-first', ai_visibility_score: '30.00', completed_at: new Date('2025-06-01T00:00:00.000Z') }),
      geoRun({ id: 'run-latest', ai_visibility_score: '70.00', completed_at: new Date('2026-01-20T00:00:00.000Z') }),
    ];

    const { generateReport } = await import('./generate-report.js');
    const row = await generateReport({ organizationId: ORG, brandId: BRAND, type: 'baseline_comparison', createdBy: 'user-1' });

    const content = row.content as unknown as {
      baseline: { geo: { aiVisibilityScore: number } | null };
      current: { geo: { aiVisibilityScore: number } | null };
      scoreDelta: { delta: number; basis: string };
      periodStart: string;
    };
    expect(content.baseline.geo?.aiVisibilityScore).toBe(30);
    expect(content.current.geo?.aiVisibilityScore).toBe(70);
    expect(content.scoreDelta).toMatchObject({ delta: 40, basis: 'geo' });
    // period_start is the baseline's own capture date, not a fixed lookback window.
    expect(new Date(content.periodStart).getTime()).toBe(new Date('2025-06-01T00:00:00.000Z').getTime());
  });

  it('ignores any caller-supplied periodStart — baseline_comparison always uses the brand\'s real earliest run', async () => {
    aiRunRows = [geoRun({ id: 'run-first', ai_visibility_score: '30.00', completed_at: new Date('2025-06-01T00:00:00.000Z') })];

    const { generateReport } = await import('./generate-report.js');
    const row = await generateReport({
      organizationId: ORG,
      brandId: BRAND,
      type: 'baseline_comparison',
      periodStart: new Date('2020-01-01T00:00:00.000Z'), // deliberately ignored
      createdBy: 'user-1',
    });

    const content = row.content as unknown as { periodStart: string };
    expect(new Date(content.periodStart).getTime()).toBe(new Date('2025-06-01T00:00:00.000Z').getTime());
  });

  it('handles a brand with no GEO data yet — baseline and current both null-geo, delta null, never a crash', async () => {
    const { generateReport } = await import('./generate-report.js');
    const row = await generateReport({ organizationId: ORG, brandId: BRAND, type: 'baseline_comparison', createdBy: 'user-1' });

    const content = row.content as unknown as { scoreDelta: { delta: number | null; basis: string } };
    expect(content.scoreDelta).toEqual({ delta: null, basis: 'none', formulaVersionsMatch: null });
  });
});
