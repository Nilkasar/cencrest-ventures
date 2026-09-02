/**
 * Usage counting for the entitlement `routes/competitor-ai-runs.ts` enforces
 * when a competitor's FIRST AI-visibility run is requested — "the number of
 * competitors with active AI-run tracking," per
 * `docs/epics/08-competitive-intelligence.md`'s UI-surface note, reusing
 * `lib/entitlements.ts`'s existing `competitors_tracked` PLAN_LIMITS entry
 * (the epic's explicit instruction: "same enforcement pattern as Epic 2's
 * competitor-add limit — reuse the entitlements helper built there").
 *
 * Deliberately a DIFFERENT counter from `routes/competitors.ts`'s own
 * `competitors_tracked` check, even though both read the same PLAN_LIMITS
 * value: that route counts every non-deleted `competitors` ROW (inert
 * profile data — a competitor can exist purely as brand-intelligence
 * metadata, never queried against an AI provider). This one counts only
 * competitors that have actually been run at least once through the (real,
 * metered, rate-limited) AI Visibility pipeline — i.e. have at least one
 * `ai_runs` row with `competitor_id` set. A plan's competitor cap therefore
 * bounds BOTH "how many competitors can exist" (Epic 2) AND, independently,
 * "how many of them may ever be actively AI-run-tracked" (this epic) — the
 * same number, two different things it's a ceiling on.
 */
import { withOrgContext } from '@bebest/database';

export async function countTrackedCompetitors(organizationId: string, brandId: string): Promise<number> {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.ai_runs.findMany({
      where: { organization_id: organizationId, brand_id: brandId, competitor_id: { not: null } },
      distinct: ['competitor_id'],
      select: { competitor_id: true },
    }),
  );
  return rows.length;
}
