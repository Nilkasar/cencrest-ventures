/**
 * Usage counting for the `ai_queries_per_month` entitlement
 * (`lib/entitlements.ts`) — how many (query x provider) AI Visibility jobs
 * an org has already dispatched this calendar month, so
 * `POST /brands/:id/ai-runs` can reject a run that would exceed the plan's
 * monthly cap BEFORE creating the `ai_runs` row or calling any provider
 * (the epic's end-to-end flow step 1).
 *
 * Counts `ai_runs.total_jobs` (the PLANNED job count, snapshotted at
 * PREPARE time), summed over every run created this month for the org —
 * not `ai_run_responses` rows, which would undercount a run that's still
 * in progress or that had provider-call failures (no row for those jobs at
 * all, see pipeline.ts). "How many jobs this org has committed to running
 * this month" is the metric BILLING_ARCHITECTURE.md's `ai_queries_per_month`
 * describes, not "how many happened to succeed."
 */
import { withOrgContext } from '@bebest/database';

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function countAiQueriesThisMonth(organizationId: string, now: Date = new Date()): Promise<number> {
  const result = await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.aggregate({
      where: { organization_id: organizationId, created_at: { gte: startOfCurrentMonthUtc(now) } },
      _sum: { total_jobs: true },
    }),
  );
  return result._sum.total_jobs ?? 0;
}
