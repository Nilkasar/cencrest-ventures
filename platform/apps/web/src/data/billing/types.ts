/**
 * Epic 16 (Billing) — wire shapes for `platform/apps/api`'s real billing
 * routes (`routes/plans.ts`, `routes/subscription.ts`). Field names/order
 * mirror `apps/api/src/lib/billing/plan-catalog.ts`'s `PlanTier`/
 * `PlanLimits` and `subscription-store.ts`'s `serializeSubscription`
 * exactly — see `platform/docs/epics/16-billing-backend.md` for the
 * response examples this was checked against.
 */

export const PLAN_TIERS = ["free", "starter", "growth", "pro", "agency", "managed", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** `null` means unlimited (or, for `agents`/`white_label`, is never null —
 *  those two are booleans, excluded from `UsageMetricKey` below because a
 *  used/limit bar makes no sense for a feature flag). */
export interface PlanLimits {
  competitors_tracked: number | null;
  queries_per_query_set: number | null;
  ai_queries_per_month: number | null;
  pages_analyzed: number | null;
  snapshots_per_month: number | null;
  team_members: number | null;
  agent_runs_per_month: number | null;
  autonomy_level_max: number | null;
  client_accounts: number | null;
  agents: boolean;
  white_label: boolean;
}

/** The subset of `PlanLimits` keys `GET /orgs/me/subscription`'s `usage`
 *  object reports one entry per — matches `NumericPlanLimitKey` on the
 *  backend (`plan-catalog.ts`). */
export type UsageMetricKey = Exclude<keyof PlanLimits, "agents" | "white_label">;

/** Display order + label for every usage metric, grouped "real count today"
 *  first, "limit exists, not counted yet" second — matches
 *  `routes/subscription.ts`'s `buildUsageSummary` comment on which four
 *  metrics are real vs. honestly `used: null`. */
export const USAGE_METRIC_LABELS: Record<UsageMetricKey, string> = {
  competitors_tracked: "Competitors tracked",
  queries_per_query_set: "Queries per query set",
  ai_queries_per_month: "AI queries this month",
  team_members: "Team members",
  pages_analyzed: "Pages analyzed",
  snapshots_per_month: "Snapshots per month",
  agent_runs_per_month: "Agent runs per month",
  autonomy_level_max: "Max autonomy level",
  client_accounts: "Client accounts",
};

export const TRACKED_USAGE_METRICS: UsageMetricKey[] = [
  "competitors_tracked",
  "queries_per_query_set",
  "ai_queries_per_month",
  "team_members",
];

export const UNTRACKED_USAGE_METRICS: UsageMetricKey[] = [
  "pages_analyzed",
  "snapshots_per_month",
  "agent_runs_per_month",
  "autonomy_level_max",
  "client_accounts",
];

export interface Plan {
  slug: PlanTier;
  name: string;
  description: string | null;
  /** Always `null` for every tier today — `docs/16-billing/BILLING_ARCHITECTURE.md`:
   *  "Prices are UNDECIDED." Rendered as "Contact us" rather than $0. */
  priceMonthlyCents: number | null;
  priceYearlyCents: number | null;
  limits: PlanLimits;
  features: Record<string, never>;
}

export type SubscriptionState = "active" | "past_due" | "canceled" | "trialing" | "incomplete" | "unpaid";

export interface SubscriptionMeta {
  status: SubscriptionState;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelledAt: string | null;
}

export interface UsageEntry {
  used: number | null;
  limit: number | null;
}

export interface SubscriptionSnapshot {
  plan: Plan;
  subscription: SubscriptionMeta;
  usage: Record<UsageMetricKey, UsageEntry>;
}

export interface Invoice {
  id: string;
  amountCents: number;
  currency: string;
  status: "paid" | "open" | "void" | "uncollectible";
  createdAt: string;
}
