/**
 * Epic 15 (Reporting & Notifications) — wires a just-generated `reports`
 * row into the shared `notify()` mechanism (`lib/notifications/notify.ts`).
 * Two notifications can come out of one report generation:
 *   1. ALWAYS — a `weekly_digest` (for `type: 'weekly'`) or `report_ready`
 *      (every other type) notification to whoever generated it, this
 *      epic's own end-to-end flow step 3's literal example of "a real
 *      trigger" routed through the shared function.
 *   2. For a `weekly` report ONLY — a `competitor_alert` notification per
 *      competitor whose movement (already computed by `lib/reporting/
 *      sections.ts`'s `getCompetitorMovements`, which itself reuses Epic
 *      8's real `computeCompetitorMovement`) crosses
 *      `SIGNIFICANT_MOVEMENT_DELTA` points. This is the concrete call site
 *      Epic 8's own "schedule trigger is deferred" gap was waiting for —
 *      see `lib/notifications/notify.ts`'s header comment for the full
 *      "what was actually found when grepping" writeup. Org-wide
 *      (`userId: null`) rather than addressed to whoever generated the
 *      report: a competitor moving is relevant to the whole org, not just
 *      the one person who happened to trigger this digest.
 */
import type { reports } from '@bebest/database';
import { notify, type NotifyDeps } from '../notifications/notify.js';
import type { ReportContent } from './generate-report.js';

/** Points of AI-visibility-score movement, positive or negative, before a
 * competitor's change is considered worth a proactive alert — the same
 * "pick a documented, if somewhat arbitrary, threshold" precedent Epic 8's
 * own `classifySourceGaps` sets for its `>= 25 -> high severity` cutoff
 * (`lib/ai-visibility/competitive.ts`), just for a different signal. */
export const SIGNIFICANT_MOVEMENT_DELTA = 5;

export async function notifyForGeneratedReport(row: reports, deps: NotifyDeps = {}): Promise<void> {
  const content = row.content as unknown as ReportContent;

  await notify(
    {
      organizationId: row.organization_id,
      userId: row.created_by,
      type: row.type === 'weekly' ? 'weekly_digest' : 'report_ready',
      title: row.name,
      body: `Your ${row.type.replace('_', ' ')} report for ${row.brand_id} is ready.`,
      actionUrl: `/reports/${row.id}`,
    },
    deps,
  );

  if (row.type !== 'weekly') return;

  for (const movement of content.competitorMovements) {
    if (movement.direction && movement.direction !== 'flat' && movement.delta !== null && Math.abs(movement.delta) >= SIGNIFICANT_MOVEMENT_DELTA) {
      await notify(
        {
          organizationId: row.organization_id,
          userId: null, // org-wide — see this file's header comment
          type: 'competitor_alert',
          title: `${movement.competitorName}'s AI visibility just moved`,
          body: movement.sentence,
          actionUrl: `/reports/${row.id}`,
        },
        deps,
      );
    }
  }
}
