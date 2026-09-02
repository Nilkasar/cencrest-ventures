import type { ClaimConfidence, CompetitorPriority, Organization } from "./types";

/**
 * Static option lists + entitlement table for the Epic 2 onboarding wizard
 * and the Settings > Brand profile tab. Kept separate from `fixtures.ts`
 * (that file is fixture *data*; this is domain *vocabulary* — plan limits,
 * enums, curated lists — that will still be true once a real backend exists).
 */

export const INDUSTRY_OPTIONS = [
  "Software & SaaS",
  "Financial Services",
  "Healthcare & Life Sciences",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Retail & E-commerce",
  "Professional Services",
  "Real Estate & Construction",
  "Education",
  "Media & Entertainment",
  "Energy & Utilities",
  "Travel & Hospitality",
  "Telecommunications",
  "Government & Public Sector",
  "Other",
] as const;

export const COMPANY_SIZE_OPTIONS = [
  { value: "startup", label: "Startup (1–10 employees)" },
  { value: "smb", label: "Small business (11–50)" },
  { value: "mid-market", label: "Mid-market (51–500)" },
  { value: "enterprise", label: "Enterprise (500+)" },
] as const;

export const COMPETITOR_PRIORITY_OPTIONS: Array<{ value: CompetitorPriority; label: string; description: string }> = [
  { value: 1, label: "Primary", description: "Who you're most often compared against" },
  { value: 2, label: "Secondary", description: "A real alternative, mentioned less often" },
  { value: 3, label: "Watch", description: "Worth monitoring, not a direct threat yet" },
];

export const CLAIM_CONFIDENCE_OPTIONS: Array<{ value: ClaimConfidence; label: string; description: string }> = [
  { value: "high", label: "High", description: "Backed by a source you could cite today" },
  { value: "medium", label: "Medium", description: "True as far as you know, not yet documented" },
  { value: "low", label: "Low", description: "Believed true, needs verification" },
];

export const CLAIM_CONFIDENCE_LABEL = new Map(CLAIM_CONFIDENCE_OPTIONS.map((option) => [option.value, option.label]));

/** Badge variant per confidence level — shared by the claims wizard step
 *  and the Settings brand-profile panel so the two never drift. */
export const CLAIM_CONFIDENCE_VARIANT: Record<ClaimConfidence, "success" | "warning" | "neutral"> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

export const COMPETITOR_PRIORITY_LABEL: Record<CompetitorPriority, string> = { 1: "Primary", 2: "Secondary", 3: "Watch" };

/** Badge variant per competitor priority — shared by the competitors
 *  wizard step and the Settings brand-profile panel. */
export const COMPETITOR_PRIORITY_VARIANT: Record<CompetitorPriority, "accent" | "neutral" | "outline"> = {
  1: "accent",
  2: "neutral",
  3: "outline",
};

/** Keyed by plain `string` (not the option union) since it's looked up
 *  against `UseCase.companySizes: string[]` — user-entered/derived data
 *  that TypeScript can't narrow to the option literal type. */
export const COMPANY_SIZE_LABEL: Map<string, string> = new Map(
  COMPANY_SIZE_OPTIONS.map((option) => [option.value, option.label.split(" (")[0] as string]),
);

/**
 * `competitors_tracked` entitlement, per `docs/epics/02-brand-intelligence.md`
 * §"Entitlements": free 2, starter 5, growth 10, pro 20, agency per-client.
 * Mirrors `apps/api/src/lib/entitlements.ts`'s `PLAN_LIMITS` exactly — keep
 * the two in sync (the backend is the source of truth once a request
 * actually round-trips; this is only the client-side counter/limit UI).
 *
 * Post-verification fix (Epic 2 QA pass): `managed` was missing from this
 * map entirely (a lookup would have been `undefined`, not just wrong) —
 * `docs/16-billing/BILLING_ARCHITECTURE.md`'s plan list has seven tiers,
 * this had six. `managed`/`enterprise` are both custom-SLA tiers with no
 * documented flat number, so both are `Infinity` here, the same treatment
 * `agency` already got — see packages/database/DECISIONS.md §15.
 */
export const PLAN_COMPETITOR_LIMITS: Record<Organization["plan"], number> = {
  free: 2,
  starter: 5,
  growth: 10,
  pro: 20,
  agency: Number.POSITIVE_INFINITY,
  managed: Number.POSITIVE_INFINITY,
  enterprise: Number.POSITIVE_INFINITY,
};

const PLAN_UPGRADE_PATH: Partial<Record<Organization["plan"], Organization["plan"]>> = {
  free: "starter",
  starter: "growth",
  growth: "pro",
  pro: "agency",
  agency: "managed",
  managed: "enterprise",
};

export function competitorLimitFor(plan: Organization["plan"]): number {
  return PLAN_COMPETITOR_LIMITS[plan];
}

export function isUnlimited(limit: number): boolean {
  return !Number.isFinite(limit);
}

/** The specific, actionable message the spec calls for — names the limit
 *  and the upgrade path, not a generic 403. Returns `undefined` when there
 *  is nowhere left to upgrade to (already unlimited, or no defined next tier). */
export function describeUpgradePath(plan: Organization["plan"]): string | undefined {
  const nextPlan = PLAN_UPGRADE_PATH[plan];
  if (!nextPlan) return undefined;
  const nextLimit = PLAN_COMPETITOR_LIMITS[nextPlan];
  const nextLimitLabel = isUnlimited(nextLimit) ? "unlimited (per-client)" : `up to ${nextLimit}`;
  return `Upgrade to ${capitalize(nextPlan)} to track ${nextLimitLabel} competitors.`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
