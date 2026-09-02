/**
 * Epic 16 (Billing) — the single source of truth for the platform's 7-tier
 * plan catalog. Transcribed verbatim from `docs/16-billing/BILLING_ARCHITECTURE.md`
 * (repo-root `docs/`, not `platform/docs/` — the epic spec's own path
 * reference is one directory off) — its "PLAN TIERS" table (names,
 * descriptions) and "Plan Limits" JSON example (the numbers).
 *
 * Deliberately a plain, dependency-free data module (no `@bebest/database`
 * import) with exactly two consumers:
 *   1. `apps/api/scripts/seed-plans.ts` — upserts one real `plans` row per
 *      entry here. Once run against a real database, THIS becomes the
 *      actual data `lib/entitlements.ts`'s `resolvePlanLimits` reads via the
 *      org's `subscriptions.plan_id` -> `plans.limits` join — the literal
 *      point of Epic 16's refactor.
 *   2. `lib/entitlements.ts`'s FALLBACK path — used only when a
 *      subscription's `plans` relation could not be loaded. See that file's
 *      header comment for exactly when and why, and why this does not
 *      defeat the "real data, not hardcoded" requirement.
 *
 * **Why this lives in `apps/api`, not `@bebest/database`** (where the schema
 * itself lives): `entitlements.test.ts` — Epics 2/5/7's own already-VERIFIED
 * regression suite, which this epic must keep passing UNMODIFIED — mocks the
 * ENTIRE `@bebest/database` module down to just `{ withOrgContext }`.
 * Importing this catalog from that package would make every regression test
 * fail with "no such export on the mock" the moment `entitlements.ts` needs
 * it at module load — not a logic bug, just where the data has to live for
 * a frozen test file's mock shape to keep working. See `entitlements.ts`'s
 * own header comment for the full reasoning.
 *
 * `competitors_tracked` / `queries_per_query_set` / `ai_queries_per_month`
 * are LOAD-BEARING REGRESSION VALUES — `entitlements.test.ts` hard-codes
 * these exact numbers per tier. Do not change one without re-running that
 * suite.
 */

export const PLAN_TIERS = ['free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanLimits {
  /** `null` means unlimited. Epics 2/5/7's original three keys. */
  competitors_tracked: number | null;
  queries_per_query_set: number | null;
  ai_queries_per_month: number | null;
  // Everything below is documented in BILLING_ARCHITECTURE.md's "Plan
  // Limits" JSON example but not yet enforced by any prior epic — seeded
  // now (per the epic brief) so a later epic (12+) has real data to gate
  // against instead of inventing its own map.
  pages_analyzed: number | null;
  snapshots_per_month: number | null;
  team_members: number | null;
  agent_runs_per_month: number | null;
  autonomy_level_max: number | null;
  client_accounts: number | null;
  /** Feature flags, not numeric caps — grouped under `limits` (not
   * `features`) because the epic spec's own literal key list puts them
   * here. See `NumericPlanLimitKey` below for why `checkUsageLimit` can
   * never be called with either of these two keys. */
  agents: boolean;
  white_label: boolean;
}

/** The subset of `PlanLimits` keys a plain "current count vs N" check
 * applies to. `agents`/`white_label` are booleans (see above) — excluded at
 * the type level so `checkUsageLimit(org, 'agents', ...)` is a compile
 * error, not a runtime one (its `limit === null` / `current + increment >
 * limit` logic is meaningless against a boolean). */
export type NumericPlanLimitKey = Exclude<keyof PlanLimits, 'agents' | 'white_label'>;

export interface PlanCatalogEntry {
  slug: PlanTier;
  name: string;
  /** Transcribed from BILLING_ARCHITECTURE.md's "Core Value" column. */
  description: string;
  /** Cents, matching `docs/06-database/SCHEMA.md` §6's literal
   * `price_monthly`/`price_yearly` column types. Always `null` for every
   * tier here, not only the two "custom/contact" ones — BILLING_ARCHITECTURE.md
   * says outright: "Prices are UNDECIDED. Do not implement with fixed
   * prices." This is a literal instruction from the source doc, not a gap. */
  priceMonthlyCents: number | null;
  priceYearlyCents: number | null;
  limits: PlanLimits;
  /** Deliberately empty for every tier — see `plans.features`'s doc comment
   * in `@bebest/database`'s `prisma/schema.prisma` for why no key names are
   * invented here. */
  features: Record<string, never>;
}

export const PLAN_CATALOG: Record<PlanTier, PlanCatalogEntry> = {
  free: {
    slug: 'free',
    name: 'Free',
    description: 'AI Visibility Snapshot — understand current state',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      competitors_tracked: 2,
      // Not in BILLING_ARCHITECTURE.md's JSON example; matches
      // docs/11-geo/GEO_ENGINE.md's "Query Universe Size" table (free
      // 20-50, upper bound used — matches this file's pre-Epic-16 value
      // exactly, see the header comment's "load-bearing" note).
      queries_per_query_set: 50,
      ai_queries_per_month: 50,
      pages_analyzed: 10,
      snapshots_per_month: 1,
      team_members: 1,
      agent_runs_per_month: null,
      autonomy_level_max: null,
      client_accounts: null,
      agents: false,
      white_label: false,
    },
    features: {},
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    description: 'Ongoing monitoring — track changes over time',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      competitors_tracked: 5,
      queries_per_query_set: 200,
      ai_queries_per_month: 500,
      pages_analyzed: 100,
      snapshots_per_month: 4,
      team_members: 3,
      agent_runs_per_month: null,
      autonomy_level_max: null,
      client_accounts: null,
      agents: false,
      white_label: false,
    },
    features: {},
  },
  growth: {
    slug: 'growth',
    name: 'Growth',
    description: 'Full SEO + GEO intelligence — understand and act',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      competitors_tracked: 10,
      queries_per_query_set: 500,
      ai_queries_per_month: 2000,
      pages_analyzed: 500,
      // Not in the JSON example for this tier (only free/starter list it) —
      // null (unlimited) rather than inventing a number, same documented-
      // placeholder reasoning already used for agency's undocumented keys.
      snapshots_per_month: null,
      team_members: 5,
      agent_runs_per_month: 10,
      autonomy_level_max: null,
      client_accounts: null,
      agents: true,
      white_label: false,
    },
    features: {},
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    description: 'AI Growth Autopilot — full recommendation + draft loop',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      competitors_tracked: 20,
      queries_per_query_set: 1400,
      ai_queries_per_month: 10000,
      pages_analyzed: 2000,
      snapshots_per_month: null,
      team_members: 10,
      agent_runs_per_month: 50,
      autonomy_level_max: 3,
      client_accounts: null,
      agents: true,
      white_label: false,
    },
    features: {},
  },
  agency: {
    slug: 'agency',
    name: 'Agency',
    description: 'Multi-client management + white-label',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      // "Agency: per-client" per the epic spec — a multi-client entitlement
      // model (Epic 18: agency_clients), not a flat cap on the agency org
      // itself. `null` is the documented placeholder until Epic 18 defines
      // the per-client shape.
      competitors_tracked: null,
      queries_per_query_set: null,
      ai_queries_per_month: 50000,
      pages_analyzed: null,
      snapshots_per_month: null,
      team_members: null,
      agent_runs_per_month: null,
      autonomy_level_max: 3,
      client_accounts: 20,
      // Not explicit in the JSON example for this tier, but `autonomy_level_max`
      // being set implies agent capability must already be on — inferred,
      // not invented, from the tier's own other documented field.
      agents: true,
      white_label: true,
    },
    features: {},
  },
  managed: {
    slug: 'managed',
    name: 'Managed',
    description: 'Human + AI service hybrid',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      // Entirely absent from BILLING_ARCHITECTURE.md's JSON example (custom-
      // negotiated by definition, per the doc's own tier description) —
      // `null` everywhere numeric. This tier must still resolve and be
      // unlimited, never silently downgraded to `free`.
      competitors_tracked: null,
      queries_per_query_set: null,
      ai_queries_per_month: null,
      pages_analyzed: null,
      snapshots_per_month: null,
      team_members: null,
      agent_runs_per_month: null,
      autonomy_level_max: null,
      client_accounts: null,
      // A higher tier's boolean feature is never a downgrade from a lower
      // tier's — `agency` (the tier immediately below) already has both
      // `true`, so `managed` (positioned above it) does too. Not stated
      // explicitly in the doc; inferred from that monotonicity rule, not
      // guessed independently.
      agents: true,
      white_label: true,
    },
    features: {},
  },
  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Custom SLAs + dedicated support',
    priceMonthlyCents: null,
    priceYearlyCents: null,
    limits: {
      competitors_tracked: null,
      // The one exception: docs/11-geo/GEO_ENGINE.md explicitly gives this
      // tier a documented floor ("Custom (5,000+)") — a real number, not a
      // guess.
      queries_per_query_set: 5000,
      ai_queries_per_month: null,
      pages_analyzed: null,
      snapshots_per_month: null,
      team_members: null,
      agent_runs_per_month: null,
      autonomy_level_max: null,
      client_accounts: null,
      agents: true,
      white_label: true,
    },
    features: {},
  },
};
