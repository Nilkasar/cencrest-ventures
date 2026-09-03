/**
 * Epic 15 (Reporting & Notifications) — Reports domain model. Mirrors
 * `apps/api/src/lib/reporting/{serialize,generate-report,sections,score-
 * baseline}.ts` + `routes/{reports,report-details}.ts` field-for-field (the
 * actual backend source was read directly, not the epic spec's prose — the
 * standing rule on this project). Every field is camelCase because the API
 * already returns a camelCase, whitelisted object, same "comes across
 * as-is" convention `data/opportunities/types.ts`/`data/measurement/
 * types.ts` already establish.
 *
 * `ScoreSnapshot`/`GeoScoreComponent`/`SeoScoreComponent` are NOT
 * redeclared here — `baseline`/`current` on a `baseline_comparison`
 * report's content are the literal same shape Epic 14's `data/measurement/
 * types.ts` already defines (both sides come from
 * `lib/measurement/scoring.ts`'s one shared `ScoreSnapshot`), so this file
 * imports those instead of forking a second copy. Likewise
 * `CompetitorMovementEntry` reuses Epic 8's `MovementResult` (`data/
 * competitive-intelligence/types.ts`) plus the two id/name fields
 * `lib/reporting/sections.ts`'s `getCompetitorMovements` adds on top of it.
 */
import type { GeoScoreComponent, Measurement, ScoreDeltaBasis, ScoreSnapshot } from "@/data/measurement/types";
import type { MovementResult } from "@/data/competitive-intelligence/types";
import type { Opportunity } from "@/data/opportunities/types";

export type { GeoScoreComponent, ScoreSnapshot };

/** `reports.type` (Prisma `String`, not an enum — see `DECISIONS.md` §29)
 *  but a closed 4-value vocabulary in practice: `routes/reports.ts`'s own
 *  Zod `REPORT_TYPES` is the sole writer, so every row this app can ever
 *  produce has exactly one of these four. */
export type ReportType = "weekly" | "monthly" | "custom" | "baseline_comparison";

export interface CompetitorMovementEntry extends MovementResult {
  competitorId: string;
  competitorName: string;
}

/** `lib/measurement/scoring.ts`'s `ScoreDeltaResult` — the baseline vs.
 *  current comparison a `baseline_comparison` report's `scoreDelta` field
 *  holds. GEO is preferred over SEO whenever both sides have a comparable
 *  GEO component (`computeScoreDelta`'s own precedence rule); `basis:
 *  "none"` means neither side had anything comparable to diff at all. */
export interface ScoreDeltaResult {
  delta: number | null;
  basis: ScoreDeltaBasis;
  /** `null` only when `basis === "none"`. `false` flags a delta spanning a
   *  scoring-formula version bump — surfaced so a reader treats the number
   *  as directionally real but less precisely comparable, never silently
   *  hidden. */
  formulaVersionsMatch: boolean | null;
}

/** The three real-data sections every `weekly`/`monthly`/`custom` report
 *  assembles (`lib/reporting/generate-report.ts`'s `StandardReportContent`):
 *  score deltas are Epic 14's own `measurements` rows recorded inside the
 *  period (an action's before/after comparison), NOT a brand-level
 *  score-over-time series — `baseline_comparison`'s `scoreDelta` below is
 *  the brand-level one. */
export interface StandardReportContent {
  reportType: "weekly" | "monthly" | "custom";
  periodStart: string;
  periodEnd: string;
  scoreDeltas: Measurement[];
  newOpportunities: Opportunity[];
  competitorMovements: CompetitorMovementEntry[];
  summary: {
    measurementCount: number;
    newOpportunityCount: number;
    competitorsMoved: number;
  };
}

/** The brand's original baseline (earliest completed GEO run + earliest
 *  SEO analyses) vs. its current state — this report type IS the "first
 *  value moment" comparison `docs/09-ux/CUSTOMER_JOURNEY.md` calls out,
 *  extended forward in time rather than shown only once at onboarding. */
export interface BaselineComparisonContent {
  reportType: "baseline_comparison";
  periodStart: string;
  periodEnd: string;
  baseline: ScoreSnapshot;
  current: ScoreSnapshot;
  scoreDelta: ScoreDeltaResult;
  newOpportunities: Opportunity[];
  competitorMovements: CompetitorMovementEntry[];
}

export type ReportContent = StandardReportContent | BaselineComparisonContent;

/** `serializeReportSummary` — the list shape, `content` omitted (a caller
 *  fetches the full immutable snapshot via `GET /reports/:id` only when it
 *  actually needs it). */
export interface ReportSummary {
  id: string;
  brandId: string;
  type: ReportType;
  name: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  /** Always `null` today — PDF export is a documented nice-to-have never
   *  implemented server-side (`lib/reporting/generate-report.ts`'s own
   *  comment). The UI must not assume this will ever be non-null. */
  pdfUrl: string | null;
  createdBy: string;
  createdAt: string;
}

/** `serializeReport` — `GET /reports/:id`'s full shape, the ONE read path
 *  this epic's immutability non-negotiable is about: `content` here is
 *  exactly what `generateReport` wrote at generation time, never re-derived
 *  from current live data. */
export interface Report extends ReportSummary {
  content: ReportContent;
}

export interface ReportsListResponse {
  items: ReportSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListReportsParams {
  type?: ReportType;
  limit?: number;
  offset?: number;
}

/** `POST /brands/me/reports/generate`'s body — `periodStart`/`periodEnd`
 *  are required together for `type: "custom"` only (the route's own Zod
 *  `.refine`), ignored for `baseline_comparison` (its period start is
 *  intrinsically "the brand's original baseline"), and an optional override
 *  for `weekly`/`monthly` (defaults to `periodEnd - 7d`/`-30d` server-side
 *  when omitted). Both are full ISO 8601 datetimes (`z.string().datetime()`
 *  server-side) — a plain `YYYY-MM-DD` string is rejected with a 422. */
export interface GenerateReportInput {
  type: ReportType;
  periodStart?: string;
  periodEnd?: string;
}
