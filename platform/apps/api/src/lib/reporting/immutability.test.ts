/**
 * Epic 15's own explicit Definition-of-Done requirement, verbatim: "A test
 * proving report immutability explicitly (generate, mutate source data,
 * re-fetch the SAME report by id, assert unchanged)."
 *
 * This is an END-TO-END proof, not a unit test of one function in
 * isolation: it drives the REAL `POST /brands/me/reports/generate` handler
 * (`routes/reports.ts`) to generate a real `baseline_comparison` report
 * from a mocked "live" `ai_runs` table (chosen because this report type's
 * `current` section is the one place `getCurrentScoreSnapshot` reads the
 * brand's LIVE score most directly), then MUTATES that same mock to add a
 * new, much higher completed run (simulating the brand's AI-visibility
 * score changing for an unrelated reason after generation), then drives
 * the REAL `GET /reports/:id` handler (`routes/report-details.ts`) and
 * asserts the content returned is byte-identical to what generation
 * produced — never reflecting the mutated live data. Same shape as
 * `lib/measurement/immutability.test.ts`'s proof for Epic 14's
 * `before_score`.
 */
import { expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
    const ops = expected as Record<string, unknown>;
    if ('gte' in ops && !((actual as Date).getTime() >= (ops.gte as Date).getTime())) return false;
    if ('lte' in ops && !((actual as Date).getTime() <= (ops.lte as Date).getTime())) return false;
    if ('lt' in ops && !((actual as Date).getTime() < (ops.lt as Date).getTime())) return false;
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
function findMany(rows: Record<string, unknown>[], args: { where?: Record<string, unknown>; orderBy?: unknown }): Record<string, unknown>[] {
  const filtered = args.where ? rows.filter((r) => matches(r, args.where!)) : [...rows];
  return applyOrder(filtered, args.orderBy);
}
function findFirst(rows: Record<string, unknown>[], args: { where?: Record<string, unknown>; orderBy?: unknown }): Record<string, unknown> | null {
  return findMany(rows, args)[0] ?? null;
}

let aiRunRows: Record<string, unknown>[] = [];
let reportRows: Record<string, unknown>[] = [];

const db = {
  organization_rate_limits: { upsert: vi.fn().mockResolvedValue({ count: 1 }) },
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn() },
  ai_runs: { findFirst: vi.fn((args: unknown) => findFirst(aiRunRows, args as never)) },
  seo_analyses: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  measurements: { findMany: vi.fn().mockResolvedValue([]) },
  unified_opportunities: { findMany: vi.fn().mockResolvedValue([]) },
  competitors: { findMany: vi.fn().mockResolvedValue([]) },
  notifications: {
    create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'notif-1', ...data })),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
  reports: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: 'report-1', ...data };
      reportRows.push(row);
      return row;
    }),
    findFirst: vi.fn((args: unknown) => findFirst(reportRows, args as never)),
  },
};
const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApps() {
  const { createReportsRoutes } = await import('../../routes/reports.js');
  const { default: reportDetails } = await import('../../routes/report-details.js');
  const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn(), sendNotification: vi.fn() };
  const generateApp = new Hono();
  generateApp.route('/brands/me/reports', createReportsRoutes(emailSender));
  const detailApp = new Hono();
  detailApp.route('/reports', reportDetails);
  return { generateApp, detailApp };
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function liveAiRun(score: number, completedAt: string): Record<string, unknown> {
  return {
    id: `run-${score}`,
    organization_id: 'org-1',
    brand_id: 'brand-1',
    competitor_id: null,
    status: 'completed',
    ai_visibility_score: String(score),
    mention_score: null,
    recommendation_score: null,
    position_score: null,
    coverage_score: null,
    scoring_formula_version: '1.0',
    completed_at: new Date(completedAt),
    created_at: new Date(completedAt),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.organization_rate_limits.upsert.mockResolvedValue({ count: 1 });
  aiRunRows = [];
  reportRows = [];

  const { __setKeysForTesting } = await import('../jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
  db.brands.findFirst.mockResolvedValue({ id: 'brand-1', organization_id: 'org-1', name: 'Acme', deleted_at: null });
});

it('a report generated today renders identically later, even after the brand\'s live score changes', async () => {
  // ── Step 1: the brand's LIVE AI-visibility score at generation time is 40. ──
  aiRunRows = [liveAiRun(40, '2026-01-01T00:00:00.000Z')];

  const { generateApp, detailApp } = await buildApps();
  const genRes = await generateApp.request('/brands/me/reports/generate', {
    method: 'POST',
    headers: { ...(await authHeader('user-1', 'org-1')), 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'baseline_comparison' }),
  });
  expect(genRes.status).toBe(201);
  const genBody = (await genRes.json()) as { report: { id: string; content: { current: { geo: { aiVisibilityScore: number } } } } };
  expect(genBody.report.content.current.geo.aiVisibilityScore).toBe(40);
  const reportId = genBody.report.id;
  const originalContent = genBody.report.content;

  // ── Step 2: the brand's LIVE score changes for an unrelated reason AFTER
  // generation (a new, later, much higher completed run). Nothing in this
  // build ever re-reads `reports.content` after it's written — confirmed
  // by the assertion below. ────────────────────────────────────────────
  aiRunRows.push(liveAiRun(90, '2026-02-01T00:00:00.000Z'));

  // Sanity check: the "live" data really did change (a fresh read would
  // now see 90, proving this isn't a no-op mutation).
  const freshRead = db.ai_runs.findFirst({ where: { organization_id: 'org-1', brand_id: 'brand-1', competitor_id: null, status: 'completed' }, orderBy: { completed_at: 'desc' } });
  expect((freshRead as { ai_visibility_score: string }).ai_visibility_score).toBe('90');

  // ── Step 3: re-fetch the SAME report by id — must render IDENTICALLY,
  // still showing the original 40, never the mutated live 90. ────────────
  const getRes = await detailApp.request(`/reports/${reportId}`, { headers: await authHeader('user-1', 'org-1') });
  expect(getRes.status).toBe(200);
  const getBody = (await getRes.json()) as { report: { id: string; content: unknown } };

  expect(getBody.report.content).toEqual(originalContent);
  const content = getBody.report.content as { current: { geo: { aiVisibilityScore: number } } };
  expect(content.current.geo.aiVisibilityScore).toBe(40);

  // Byte-identical, not just "structurally similar" — the DoD's own word.
  expect(JSON.stringify(getBody.report.content)).toBe(JSON.stringify(originalContent));
});
