import { apiClient, ApiError } from "@/lib/api-client";
import type { GenerateReportInput, ListReportsParams, Report, ReportsListResponse } from "./types";

/**
 * Epic 15 (Reporting & Notifications)'s data-access seam for Reports — same
 * role `data/opportunities/client.ts` plays for Epic 9. Every screen calls
 * through here, never `apiClient` directly. Calls `platform/apps/api`'s
 * real, tested routes from the first line, no fixture layer:
 *
 *   GET  /api/brands/me/reports          -> listReports()
 *   POST /api/brands/me/reports/generate -> generateReport()
 *   GET  /api/reports/:id                -> getReport()
 */

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** Thrown when any route 404s with the shared `NO_BRAND_ERROR` body — the
 *  organization hasn't completed brand onboarding yet. Same precedent
 *  `NoBrandProfileError` (`data/opportunities/client.ts`) sets. */
export class NoBrandProfileError extends Error {
  constructor() {
    super("Complete your brand profile before generating reports.");
    this.name = "NoBrandProfileError";
  }
}

/** A foreign/deleted report id — never a 403 that would confirm existence
 *  (tenant isolation), per `report-details.ts`'s own flat-404 convention. */
export class ReportNotFoundError extends Error {
  constructor(message = "That report couldn't be found.") {
    super(message);
    this.name = "ReportNotFoundError";
  }
}

/** Sorted server-side by `generatedAt` desc (`routes/reports.ts`'s `GET /`
 *  handler) — never re-sorted client-side. A 404 (no brand profile yet)
 *  degrades to an empty page rather than an error, same "let the empty
 *  state carry it" precedent `listOpportunities` uses for the same
 *  situation. */
export async function listReports(params: ListReportsParams = {}): Promise<ReportsListResponse> {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  try {
    return await apiClient.get<ReportsListResponse>(`/brands/me/reports?${query.toString()}`);
  } catch (err) {
    if (isNotFound(err)) {
      return { items: [], total: 0, limit: params.limit ?? 25, offset: params.offset ?? 0 };
    }
    throw err;
  }
}

/** Assembles + persists a new immutable report snapshot and fires the
 *  `report_ready`/`weekly_digest` notification (`notifyForGeneratedReport`,
 *  server-side) — the manual trigger this codebase's "no live scheduler
 *  yet" gap makes the real mechanism for all four types, weekly/monthly
 *  included (see `lib/reporting/generate-report.ts`'s header comment). */
export async function generateReport(input: GenerateReportInput): Promise<Report> {
  try {
    const { report } = await apiClient.post<{ report: Report }>("/brands/me/reports/generate", input);
    return report;
  } catch (err) {
    if (isNotFound(err)) throw new NoBrandProfileError();
    throw err;
  }
}

/** The full immutable `content` snapshot — exactly what `generateReport`
 *  wrote at generation time, never re-derived from current live data (this
 *  epic's non-negotiable). */
export async function getReport(id: string): Promise<Report> {
  try {
    const { report } = await apiClient.get<{ report: Report }>(`/reports/${id}`);
    return report;
  } catch (err) {
    if (isNotFound(err)) throw new ReportNotFoundError();
    throw err;
  }
}
