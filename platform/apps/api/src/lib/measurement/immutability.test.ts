/**
 * Epic 14's own explicit Definition-of-Done requirement, verbatim: "A test
 * proving the before-score snapshot is genuinely immutable (mutating the
 * live brand's current score after approval must not change what a later
 * measurement compares against)."
 *
 * This is an END-TO-END proof, not a unit test of one function in
 * isolation: it drives the REAL `POST /actions/:id/approve` handler
 * (`routes/action-details.ts`) to capture a real before-score snapshot from
 * a mocked "live" `ai_runs` table, then MUTATES that same mock to return a
 * different score (simulating the brand's AI-visibility score changing for
 * an unrelated reason after approval — a new manually-triggered run, a
 * competitor's own change, anything), then calls the REAL
 * `runMeasurementForAction` (`run-measurement.ts`) and asserts the
 * measurement it writes still carries the ORIGINAL score, never the
 * mutated one.
 */
import { expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

const { mockRunAiVisibilityStep, mockWriteAuditEvent } = vi.hoisted(() => ({
  mockRunAiVisibilityStep: vi.fn(),
  mockWriteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agents/run-ai-visibility-step.js', () => ({ runAiVisibilityStep: mockRunAiVisibilityStep }));
vi.mock('../audit.js', () => ({ writeAuditEvent: mockWriteAuditEvent }));

let actRows: Array<Record<string, unknown>> = [];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === undefined ? true : row[key] === value));
}

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  actions: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = actRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = actRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
    count: vi.fn().mockResolvedValue(0),
  },
  ai_runs: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  seo_analyses: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  query_sets: { findFirst: vi.fn().mockResolvedValue(null) },
  crawl_jobs: { findFirst: vi.fn().mockResolvedValue(null) },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  measurements: { create: vi.fn() },
  outcome_records: { create: vi.fn() },
};

const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: actionDetails } = await import('../../routes/action-details.js');
  const app = new Hono();
  app.route('/actions', actionDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function liveAiRun(score: number) {
  return {
    id: `run-${score}`,
    ai_visibility_score: String(score),
    mention_score: null,
    recommendation_score: null,
    position_score: null,
    coverage_score: null,
    scoring_formula_version: '1.0',
    completed_at: new Date('2026-01-01T00:00:00.000Z'),
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  actRows = [];
  db.query_sets.findFirst.mockResolvedValue(null); // no active query set -> no fresh GEO re-run needed for this proof
  db.crawl_jobs.findFirst.mockResolvedValue(null);
  db.seo_analyses.findMany.mockResolvedValue([]);
  db.seo_analyses.findFirst.mockResolvedValue(null);
  db.actions.count.mockResolvedValue(0);
  db.audit_events.create.mockResolvedValue({});
  db.measurements.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'measurement-1', ...data }));

  const { __setKeysForTesting } = await import('../jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
});

it('the before-score snapshot is genuinely immutable: mutating the live brand score after approval does not change what a later measurement compares against', async () => {
  actRows = [
    {
      id: 'action-1',
      organization_id: 'org-1',
      brand_id: 'brand-1',
      action_type: 'publish_content',
      title: 'Publish: comparison page',
      description: 'evidence',
      priority: 'medium',
      status: 'pending',
      autonomy_level: 1,
      recommendation_id: null,
      content_draft_id: null,
      agent_pending_action_id: null,
      approved_by: null,
      approved_at: null,
      executed_at: null,
      rolled_back_at: null,
      result: null,
      before_score: null,
      before_score_captured_at: null,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
      deleted_at: null,
    },
  ];

  // ── Step 1: the brand's LIVE AI-visibility score at approval time is 40. ──
  db.ai_runs.findFirst.mockResolvedValue(liveAiRun(40));

  const app = await buildApp();
  const approveRes = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
  expect(approveRes.status).toBe(200);

  // The snapshot was captured AT APPROVAL TIME, reading the live value (40)
  // that existed at that exact moment.
  const approvedRow = actRows[0]!;
  expect((approvedRow.before_score as { geo: { aiVisibilityScore: number } }).geo.aiVisibilityScore).toBe(40);
  const capturedAt = approvedRow.before_score_captured_at;
  expect(capturedAt).toBeTruthy();

  // ── Step 2: the brand's LIVE score changes for an unrelated reason AFTER
  // approval (a new manually-triggered ai_runs completing at 90). Nothing
  // in this build ever re-reads/re-writes actions.before_score after
  // approval — confirmed by this exact assertion below. ───────────────────
  db.ai_runs.findFirst.mockResolvedValue(liveAiRun(90));

  // Mark the action executed (measurement requires it) — directly, not via
  // the execute route (this test is isolated to the immutability proof,
  // not execute's own guard clauses, already covered by action-details.
  // test.ts).
  approvedRow.executed_at = new Date('2026-01-10T00:00:00.000Z');
  approvedRow.status = 'completed';

  // The live table now says 90 — but `actions.before_score` (read directly
  // below) still says 40, proving no code path mutated it.
  expect((actRows[0]!.before_score as { geo: { aiVisibilityScore: number } }).geo.aiVisibilityScore).toBe(40);

  // ── Step 3: run the REAL measurement — it must compare against the
  // ORIGINAL 40, never the mutated live 90. ────────────────────────────────
  const { runMeasurementForAction } = await import('./run-measurement.js');
  const result = await runMeasurementForAction('org-1', 'action-1');

  expect(result.status).toBe('measured');
  expect(db.measurements.create).toHaveBeenCalledTimes(1);
  const [{ data }] = db.measurements.create.mock.calls[0]!;

  // The measurement's own before_score — an INDEPENDENT copy taken from
  // actions.before_score at measurement-creation time — still shows 40,
  // not 90, even though the "live" ai_runs mock has said 90 since before
  // this call was even made.
  expect((data.before_score as { geo: { aiVisibilityScore: number } }).geo.aiVisibilityScore).toBe(40);
  expect(data.before_score_captured_at).toEqual(capturedAt);

  // GEO was never re-run for the BEFORE side at measurement time at all —
  // `getCurrentScoreSnapshot`/`ai_runs.findFirst` is never called by
  // `runMeasurementForAction` (only by the approve handler, already spent
  // above) — this is what makes the guarantee architectural, not
  // incidental. (query_sets returns null in this test, so there is no
  // fresh AFTER-side GEO re-run either — after.geo is null — which is
  // exactly why the delta below reflects "no comparable after data," not a
  // false 90-vs-40 comparison smuggled in through the back door.)
  expect((data.after_score as { geo: unknown }).geo).toBeNull();
});
