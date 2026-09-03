/**
 * Usage counting for the `agent_runs_per_month` entitlement
 * (`lib/entitlements.ts`) — mirrors `lib/ai-visibility/usage.ts`'s
 * `countAiQueriesThisMonth` exactly (same UTC-month-boundary convention),
 * counting one unit per `agent_runs` row created this calendar month for
 * the org, regardless of `agent_name` — the plan's limit is a single
 * combined cap across GEO/SEO/Growth agents (BILLING_ARCHITECTURE.md names
 * one `agent_runs_per_month` key, not one per agent type).
 */
import { withOrgContext } from '@bebest/database';

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function countAgentRunsThisMonth(organizationId: string, now: Date = new Date()): Promise<number> {
  return withOrgContext(organizationId, (tx) =>
    tx.agent_runs.count({
      where: { organization_id: organizationId, created_at: { gte: startOfCurrentMonthUtc(now) } },
    }),
  );
}
