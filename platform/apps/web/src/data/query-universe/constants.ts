import type { QueryCategory, QueryIntentType, QueryPriority, QuerySetStatus, PlanTier } from "./types";
import { QUERY_CATEGORIES } from "./types";

/**
 * Static vocabulary for the Query Universe screen — plan limits, category
 * copy, badge variants. Kept separate from `seed.ts` (fixture *data*) the
 * same way `data/brand-constants.ts` is kept separate from `data/fixtures.ts`.
 */

export interface QueryCategoryMeta {
  label: string;
  /** The template pattern from `docs/11-geo/GEO_ENGINE.md`'s numbered list,
   *  shown as a caption under the category header so the grouped view reads
   *  as the documented taxonomy, not an arbitrary bucket. */
  pattern: string;
}

export const QUERY_CATEGORY_META: Record<QueryCategory, QueryCategoryMeta> = {
  category: { label: "Category", pattern: "What is [category]?" },
  problem: { label: "Problem", pattern: "How do I solve [problem]?" },
  commercial: { label: "Commercial", pattern: "Best [category] for [use case]?" },
  comparison: { label: "Comparison", pattern: "[Brand] vs [Competitor]" },
  feature: { label: "Feature", pattern: "Which [category] has [feature]?" },
  industry: { label: "Industry", pattern: "Best [category] for [industry]?" },
  size: { label: "Size", pattern: "Best [category] for [company size]?" },
  geography: { label: "Geography", pattern: "Best [category] in [location]?" },
  intent: { label: "Intent (job-to-be-done)", pattern: "How to [specific job]?" },
  authority: { label: "Authority", pattern: "Who are the experts in [category]?" },
};

/** Every category maps to exactly one of the spec's four `intent_type`
 *  values — this is the join between the ten generation categories and the
 *  `queries.intent_type` column the epic's domain model actually persists. */
export const CATEGORY_INTENT_TYPE: Record<QueryCategory, QueryIntentType> = {
  category: "informational",
  problem: "informational",
  commercial: "commercial",
  comparison: "comparison",
  feature: "commercial",
  industry: "commercial",
  size: "commercial",
  geography: "commercial",
  intent: "informational",
  authority: "informational",
};

/** Default priority template-generated queries land at, before a human
 *  reprioritizes them. Commercial/Comparison/Industry are the categories
 *  most directly tied to a buying decision, so they default to high. */
export const CATEGORY_DEFAULT_PRIORITY: Record<QueryCategory, QueryPriority> = {
  category: 3,
  problem: 2,
  commercial: 1,
  comparison: 1,
  feature: 2,
  industry: 1,
  size: 2,
  geography: 2,
  intent: 3,
  authority: 3,
};

export const INTENT_TYPE_LABEL: Record<QueryIntentType, string> = {
  informational: "Informational",
  commercial: "Commercial",
  comparison: "Comparison",
  transactional: "Transactional",
};

export const INTENT_TYPE_BADGE_VARIANT: Record<QueryIntentType, "neutral" | "accent" | "outline" | "warning"> = {
  informational: "neutral",
  commercial: "accent",
  comparison: "warning",
  transactional: "outline",
};

export const PRIORITY_LABEL: Record<QueryPriority, string> = { 1: "High", 2: "Medium", 3: "Low" };

export const STATUS_LABEL: Record<QuerySetStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const STATUS_BADGE_VARIANT: Record<QuerySetStatus, "warning" | "success" | "neutral"> = {
  draft: "warning",
  active: "success",
  archived: "neutral",
};

/**
 * `docs/11-geo/GEO_ENGINE.md`'s "Query Universe Size" table: Free 20–50
 * (upper bound used as the deterministic cap), Starter 200, Growth 500,
 * Pro 1,400+, Enterprise custom (5,000+, upper bound used the same way).
 *
 * `agency`/`managed` aren't in that table. Unlike `PLAN_COMPETITOR_LIMITS`
 * (where "Agency: per-client" in `BILLING_ARCHITECTURE.md` justified
 * treating undocumented tiers as unlimited), the GEO doc never describes an
 * unlimited query universe at any tier — even Enterprise is "custom
 * (5,000+)", a number, not "no cap". So the two undocumented tiers here
 * fall back to the Enterprise number rather than `Infinity`: generating an
 * uncapped query set has no basis in the spec at any plan.
 */
export const PLAN_QUERY_LIMITS: Record<PlanTier, number> = {
  free: 50,
  starter: 200,
  growth: 500,
  pro: 1400,
  agency: 5000,
  managed: 5000,
  enterprise: 5000,
};

export function queryLimitFor(plan: PlanTier): number {
  return PLAN_QUERY_LIMITS[plan];
}

const PLAN_UPGRADE_PATH: Partial<Record<PlanTier, PlanTier>> = {
  free: "starter",
  starter: "growth",
  growth: "pro",
  pro: "enterprise",
};

/** The specific "here's the limit and the upgrade path" message the epic
 *  brief calls for (same pattern as `data/brand-constants.ts`'s
 *  `describeUpgradePath`) — `undefined` once there's nowhere higher to send
 *  them. */
export function describeQueryUpgradePath(plan: PlanTier): string | undefined {
  const nextPlan = PLAN_UPGRADE_PATH[plan];
  if (!nextPlan) return undefined;
  const nextLimit = PLAN_QUERY_LIMITS[nextPlan];
  return `Upgrade to ${capitalize(nextPlan)} to generate up to ${nextLimit.toLocaleString()} queries.`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export { QUERY_CATEGORIES };
