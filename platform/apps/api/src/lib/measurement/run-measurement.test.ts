import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockRunAiVisibilityStep, mockReanalyzeSeoForBrand, mockWriteAuditEvent } = vi.hoisted(() => ({
  mockRunAiVisibilityStep: vi.fn(),
  mockReanalyzeSeoForBrand: vi.fn(),
  mockWriteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agents/run-ai-visibility-step.js', () => ({ runAiVisibilityStep: mockRunAiVisibilityStep }));
vi.mock('./reanalyze-seo.js', () => ({ reanalyzeSeoForBrand: mockReanalyzeSeoForBrand }));
vi.mock('../audit.js', () => ({ writeAuditEvent: mockWriteAuditEvent }));

let actionsCountResult = 0;

const db = {
  actions: { findFirst: vi.fn(), count: vi.fn(async () => actionsCountResult) },
  query_sets: { findFirst: vi.fn() },
  ai_runs: { findUniqueOrThrow: vi.fn() },
  measurements: { create: vi.fn() },
  outcome_records: { create: vi.fn() },
};

vi.mock('@bebest/database', () => ({
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));

import { runMeasurementForAction } from './run-measurement.js';

const BEFORE_SCORE = {
  geo: {
    aiRunId: 'run-before',
    aiVisibilityScore: 40,
    mentionScore: 40,
    recommendationScore: 40,
    positionScore: 40,
    coverageScore: 40,
    formulaVersion: '1.0',
    measuredAt: '2026-01-01T00:00:00.000Z',
  },
  seo: null,
  capturedAt: '2026-01-01T00:00:00.000Z',
};

function makeAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'action-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    executed_at: new Date('2026-01-15T00:00:00.000Z'),
    approved_by: 'user-1',
    before_score: BEFORE_SCORE,
    before_score_captured_at: new Date('2026-01-01T00:00:00.000Z'),
    opportunity_recommendations: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  actionsCountResult = 0;
  db.actions.findFirst.mockResolvedValue(makeAction());
  db.query_sets.findFirst.mockResolvedValue(null);
  mockReanalyzeSeoForBrand.mockResolvedValue(null);
  db.measurements.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'measurement-1', ...data }));
  db.outcome_records.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'outcome-1', ...data }));
});

describe('runMeasurementForAction — guard clauses', () => {
  it('skips (action_not_found) when the action does not exist for this org', async () => {
    db.actions.findFirst.mockResolvedValue(null);
    const result = await runMeasurementForAction('org-1', 'action-1');
    expect(result).toEqual({ status: 'skipped', reason: 'action_not_found' });
    expect(db.measurements.create).not.toHaveBeenCalled();
  });

  it('skips (not_executed) when the action has no executed_at', async () => {
    db.actions.findFirst.mockResolvedValue(makeAction({ executed_at: null }));
    const result = await runMeasurementForAction('org-1', 'action-1');
    expect(result).toEqual({ status: 'skipped', reason: 'not_executed' });
    expect(db.measurements.create).not.toHaveBeenCalled();
  });

  it('skips (no_before_score) when the action has no before_score snapshot', async () => {
    db.actions.findFirst.mockResolvedValue(makeAction({ before_score: null, before_score_captured_at: null }));
    const result = await runMeasurementForAction('org-1', 'action-1');
    expect(result).toEqual({ status: 'skipped', reason: 'no_before_score' });
    expect(db.measurements.create).not.toHaveBeenCalled();
  });
});

describe('runMeasurementForAction — GEO re-run', () => {
  it('never calls Epic 7\'s real pipeline when the brand has no active query set — after.geo stays null, never fabricated', async () => {
    db.query_sets.findFirst.mockResolvedValue(null);
    await runMeasurementForAction('org-1', 'action-1');
    expect(mockRunAiVisibilityStep).not.toHaveBeenCalled();
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect((data.after_score as { geo: unknown }).geo).toBeNull();
  });

  it('calls Epic 7\'s REAL runAiVisibilityStep (never a reimplementation) with the brand\'s active query set and the approver\'s id', async () => {
    db.query_sets.findFirst.mockResolvedValue({ id: 'qs-1' });
    mockRunAiVisibilityStep.mockResolvedValue({ aiRunId: 'run-after', aiVisibilityScore: 55 });
    db.ai_runs.findUniqueOrThrow.mockResolvedValue({
      id: 'run-after',
      ai_visibility_score: '55.00',
      mention_score: '50.00',
      recommendation_score: '55.00',
      position_score: '50.00',
      coverage_score: '60.00',
      scoring_formula_version: '1.0',
      completed_at: new Date('2026-01-29T00:00:00.000Z'),
      created_at: new Date('2026-01-29T00:00:00.000Z'),
    });

    await runMeasurementForAction('org-1', 'action-1');

    expect(mockRunAiVisibilityStep).toHaveBeenCalledWith('org-1', 'brand-1', 'qs-1', 'user-1');
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect((data.after_score as { geo: { aiVisibilityScore: number } }).geo.aiVisibilityScore).toBe(55);
    expect(data.after_ai_run_id).toBe('run-after');
    expect(data.score_delta).toBe(15); // 55 - 40
  });

  it('leaves after.geo null (never a stale fallback) when runAiVisibilityStep returns an error variant', async () => {
    db.query_sets.findFirst.mockResolvedValue({ id: 'qs-1' });
    mockRunAiVisibilityStep.mockResolvedValue({ error: 'entitlement', message: 'limit reached' });

    await runMeasurementForAction('org-1', 'action-1');

    expect(db.ai_runs.findUniqueOrThrow).not.toHaveBeenCalled();
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect((data.after_score as { geo: unknown }).geo).toBeNull();
    // No comparable pair at all (before has geo, after has neither geo nor seo) -> basis none, delta null.
    expect(data.score_delta).toBeNull();
  });
});

describe('runMeasurementForAction — SEO re-run', () => {
  it('calls Epic 4\'s real reanalyzeSeoForBrand and stores its result verbatim as after.seo', async () => {
    const seoComponent = { overallScore: 72, technicalScore: 70, contentScore: 74, pagesAnalyzed: 3, formulaVersion: '1.0', measuredAt: '2026-01-29T00:00:00.000Z' };
    mockReanalyzeSeoForBrand.mockResolvedValue(seoComponent);

    await runMeasurementForAction('org-1', 'action-1');

    expect(mockReanalyzeSeoForBrand).toHaveBeenCalledWith('org-1', 'brand-1');
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect((data.after_score as { seo: unknown }).seo).toEqual(seoComponent);
  });
});

describe('runMeasurementForAction — before_score is read verbatim, never recomputed', () => {
  it('copies actions.before_score/.before_score_captured_at into the measurement row exactly as stored', async () => {
    await runMeasurementForAction('org-1', 'action-1');
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect(data.before_score).toEqual(BEFORE_SCORE);
    expect(data.before_score_captured_at).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});

describe('runMeasurementForAction — attribution & confounding', () => {
  it('checks for OTHER actions on the SAME brand executed in the measurement window', async () => {
    actionsCountResult = 0;
    await runMeasurementForAction('org-1', 'action-1');
    expect(db.actions.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization_id: 'org-1',
          brand_id: 'brand-1',
          id: { not: 'action-1' },
        }),
      }),
    );
  });

  it('downgrades confidence to medium when another action was executed on the brand in the window, even for a large delta', async () => {
    db.query_sets.findFirst.mockResolvedValue({ id: 'qs-1' });
    mockRunAiVisibilityStep.mockResolvedValue({ aiRunId: 'run-after', aiVisibilityScore: 90 });
    db.ai_runs.findUniqueOrThrow.mockResolvedValue({
      id: 'run-after', ai_visibility_score: '90.00', mention_score: null, recommendation_score: null, position_score: null, coverage_score: null,
      scoring_formula_version: '1.0', completed_at: new Date(), created_at: new Date(),
    });
    actionsCountResult = 1;

    const result = await runMeasurementForAction('org-1', 'action-1');
    expect(result).toMatchObject({ status: 'measured', attributionConfidence: 'medium' });
  });
});

describe('runMeasurementForAction — outcome_records (the LEARN step)', () => {
  it('writes an outcome_records row when the action has a real recommendation chain, using the REAL enums from that chain', async () => {
    db.actions.findFirst.mockResolvedValue(
      makeAction({
        opportunity_recommendations: {
          action_type: 'build_citations',
          unified_opportunities: { type: 'geo' },
        },
      }),
    );

    const result = await runMeasurementForAction('org-1', 'action-1');

    expect(db.outcome_records.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          measurement_id: 'measurement-1',
          opportunity_type: 'geo',
          action_type: 'build_citations',
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'measured', outcomeRecordId: 'outcome-1' });
  });

  it('does NOT write an outcome_records row (and does not guess) when the action has no recommendation chain at all', async () => {
    db.actions.findFirst.mockResolvedValue(makeAction({ opportunity_recommendations: null }));

    const result = await runMeasurementForAction('org-1', 'action-1');

    expect(db.outcome_records.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'measured', outcomeRecordId: null });
    // The measurements row itself is still written — only the LEARN-table
    // row is skipped.
    expect(db.measurements.create).toHaveBeenCalled();
  });
});

describe('runMeasurementForAction — transparency (audit event)', () => {
  it('writes a measurement.completed audit event attributed to the system, carrying the real approver id', async () => {
    const result = await runMeasurementForAction('org-1', 'action-1');
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'system',
        action: 'measurement.completed',
        entityType: 'measurement',
        entityId: 'measurement-1',
        result: 'success',
      }),
    );
    expect(result.status).toBe('measured');
  });
});

describe('runMeasurementForAction — attribution language, end to end', () => {
  it('never asserts certainty in the stored attribution_notes', async () => {
    await runMeasurementForAction('org-1', 'action-1');
    const [{ data }] = db.measurements.create.mock.calls[0]!;
    expect(data.attribution_notes as string).not.toMatch(/\bconfirmed\b|\bproven\b/i);
  });
});
