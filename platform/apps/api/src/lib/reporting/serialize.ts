/**
 * Epic 15 (Reporting & Notifications) response shape — shared by
 * `routes/reports.ts` (list + generate) and `routes/report-details.ts`
 * (`GET /reports/:id`), same "one serializer, identical shape regardless
 * of which route returned it" precedent every other epic's serializer in
 * this codebase already establishes.
 */
import type { reports } from '@bebest/database';

export function serializeReport(row: reports) {
  return {
    id: row.id,
    brandId: row.brand_id,
    type: row.type,
    name: row.name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    content: row.content,
    pdfUrl: row.file_path,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** List responses omit the (potentially large) `content` blob — a caller
 * fetches the full immutable snapshot via `GET /reports/:id` when it
 * actually needs it, same "list is a summary, detail is the full record"
 * convention `serializeOpportunity`/`serializeOpportunityDetail` already
 * establishes for Epic 9. */
export function serializeReportSummary(row: reports) {
  const { content: _content, ...summary } = serializeReport(row);
  return summary;
}
