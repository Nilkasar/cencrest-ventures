/**
 * Epic 15 (Reporting & Notifications) — the ONE function that assembles and
 * persists a `reports` row for all four report types
 * (`docs/epics/15-reporting-notifications.md`'s domain model: `weekly|
 * monthly|custom|baseline_comparison`). Every section it writes into
 * `content` comes from an already-computed Epic 4/7/8/9/14 table or a real,
 * already-built function from the epic that owns it (`lib/reporting/
 * sections.ts`, `lib/reporting/score-baseline.ts`, Epic 14's
 * `getCurrentScoreSnapshot`/`computeScoreDelta`) — this file's own logic is
 * templating/aggregation only, the epic's own non-negotiable, verbatim.
 *
 * ── The immutability non-negotiable ─────────────────────────────────────
 * `content` is written ONCE, here, and never touched again by any other
 * code path in this build (grep confirms `reports.update` has no call site
 * anywhere in `apps/api/src`) — a report generated today renders identically
 * next month even if the brand's live scores change since. See
 * `lib/reporting/immutability.test.ts` for the explicit end-to-end proof
 * this epic's DoD requires (generate, mutate the underlying live data,
 * re-fetch the SAME report by id, assert byte-identical content).
 *
 * ── No real scheduler ────────────────────────────────────────────────────
 * The spec's API surface names one endpoint, `POST /brands/:id/reports/
 * generate`, described there as "(custom, manual trigger)" — but also
 * requires ALL FOUR types to exist and be independently triggerable (its
 * own "implement all four" instruction) and its end-to-end flow explicitly
 * drives a "trigger weekly digest generation" step. This codebase has no
 * durable queue/cron anywhere yet (the same `// TODO: durable queue
 * (pg-boss)` gap every background job in this codebase already documents —
 * Epic 14's 4-week re-measurement trigger has the identical shape: a real,
 * directly-callable function with no live scheduler calling it
 * automatically). `generateReport` is that real, directly-callable
 * function for every type; `routes/reports.ts`'s `POST /generate` accepts a
 * `type` field for all four and IS today's manual-trigger mechanism for
 * what would eventually be a scheduled weekly/monthly job — see this
 * epic's backend doc's "what's not done" section for the honest scope
 * boundary.
 */
import { withOrgContext, type Prisma, type reports } from '@bebest/database';
import { getCurrentScoreSnapshot } from '../measurement/current-score-snapshot.js';
import { computeScoreDelta } from '../measurement/scoring.js';
import { serializeMeasurement } from '../measurement/serialize.js';
import { serializeOpportunity } from '../opportunities/serialize.js';
import { writeAuditEvent } from '../audit.js';
import { getBaselineScoreSnapshot } from './score-baseline.js';
import { getCompetitorMovements, getNewOpportunities, getScoreDeltas, type CompetitorMovementEntry } from './sections.js';

export type ReportType = 'weekly' | 'monthly' | 'custom' | 'baseline_comparison';

const DEFAULT_PERIOD_DAYS: Record<Exclude<ReportType, 'baseline_comparison'>, number> = {
  weekly: 7,
  monthly: 30,
  // `custom` has no sensible default — the caller (route-level Zod schema)
  // requires an explicit periodStart/periodEnd for this type; this constant
  // is never actually read for it (see `generateReport` below), kept only
  // so the `Record` stays total over the non-baseline types.
  custom: 30,
};

export interface GenerateReportParams {
  organizationId: string;
  brandId: string;
  type: ReportType;
  /** Required for `custom`; optional override for `weekly`/`monthly`
   * (defaults to `periodEnd - 7d`/`periodEnd - 30d`); IGNORED for
   * `baseline_comparison`, whose period start is intrinsically "the
   * brand's original baseline" — see `score-baseline.ts`. */
  periodStart?: Date;
  /** Defaults to now. */
  periodEnd?: Date;
  createdBy: string;
}

function defaultPeriodStart(type: ReportType, periodEnd: Date): Date {
  const days = DEFAULT_PERIOD_DAYS[type as Exclude<ReportType, 'baseline_comparison'>] ?? 7;
  return new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);
}

function reportName(type: ReportType, periodStart: Date, periodEnd: Date): string {
  const label: Record<ReportType, string> = {
    weekly: 'Weekly Digest',
    monthly: 'Monthly Performance Report',
    custom: 'Custom Report',
    baseline_comparison: 'Baseline Comparison Report',
  };
  return `${label[type]} (${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)})`;
}

interface StandardReportContent {
  reportType: 'weekly' | 'monthly' | 'custom';
  periodStart: string;
  periodEnd: string;
  scoreDeltas: ReturnType<typeof serializeMeasurement>[];
  newOpportunities: ReturnType<typeof serializeOpportunity>[];
  competitorMovements: CompetitorMovementEntry[];
  summary: {
    measurementCount: number;
    newOpportunityCount: number;
    competitorsMoved: number;
  };
}

interface BaselineComparisonContent {
  reportType: 'baseline_comparison';
  periodStart: string;
  periodEnd: string;
  baseline: Awaited<ReturnType<typeof getBaselineScoreSnapshot>>;
  current: Awaited<ReturnType<typeof getCurrentScoreSnapshot>>;
  scoreDelta: ReturnType<typeof computeScoreDelta>;
  newOpportunities: ReturnType<typeof serializeOpportunity>[];
  competitorMovements: CompetitorMovementEntry[];
}

export type ReportContent = StandardReportContent | BaselineComparisonContent;

async function buildContent(params: GenerateReportParams): Promise<{ content: ReportContent; periodStart: Date; periodEnd: Date }> {
  const periodEnd = params.periodEnd ?? new Date();

  if (params.type === 'baseline_comparison') {
    const baseline = await getBaselineScoreSnapshot(params.organizationId, params.brandId);
    const periodStart = new Date(baseline.capturedAt);
    const current = await getCurrentScoreSnapshot(params.organizationId, params.brandId);
    const scoreDelta = computeScoreDelta(baseline, current);
    const [newOpportunities, competitorMovements] = await Promise.all([
      getNewOpportunities(params.organizationId, params.brandId, periodStart, periodEnd),
      getCompetitorMovements(params.organizationId, params.brandId, periodStart, periodEnd),
    ]);

    const content: BaselineComparisonContent = {
      reportType: 'baseline_comparison',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      baseline,
      current,
      scoreDelta,
      newOpportunities: newOpportunities.map(serializeOpportunity),
      competitorMovements,
    };
    return { content, periodStart, periodEnd };
  }

  const periodStart = params.periodStart ?? defaultPeriodStart(params.type, periodEnd);

  const [scoreDeltas, newOpportunities, competitorMovements] = await Promise.all([
    getScoreDeltas(params.organizationId, params.brandId, periodStart, periodEnd),
    getNewOpportunities(params.organizationId, params.brandId, periodStart, periodEnd),
    getCompetitorMovements(params.organizationId, params.brandId, periodStart, periodEnd),
  ]);

  const content: StandardReportContent = {
    reportType: params.type,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    scoreDeltas: scoreDeltas.map(serializeMeasurement),
    newOpportunities: newOpportunities.map(serializeOpportunity),
    competitorMovements,
    summary: {
      measurementCount: scoreDeltas.length,
      newOpportunityCount: newOpportunities.length,
      competitorsMoved: competitorMovements.filter((m) => m.direction && m.direction !== 'flat').length,
    },
  };
  return { content, periodStart, periodEnd };
}

export async function generateReport(params: GenerateReportParams): Promise<reports> {
  const { content, periodStart, periodEnd } = await buildContent(params);
  const generatedAt = new Date();

  const row = await withOrgContext(params.organizationId, (tx) =>
    tx.reports.create({
      data: {
        organization_id: params.organizationId,
        brand_id: params.brandId,
        name: reportName(params.type, periodStart, periodEnd),
        type: params.type,
        format: 'json', // PDF export is documented nice-to-have, never blocking — see this epic's backend doc.
        status: 'completed',
        period_start: periodStart,
        period_end: periodEnd,
        generated_at: generatedAt,
        content: content as unknown as Prisma.InputJsonValue,
        created_by: params.createdBy,
        completed_at: generatedAt,
      },
    }),
  );

  await writeAuditEvent({
    userId: params.createdBy,
    organizationId: params.organizationId,
    actorType: 'user',
    action: 'report.generated',
    entityType: 'report',
    entityId: row.id,
    result: 'success',
    details: { type: params.type, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
  });

  return row;
}
