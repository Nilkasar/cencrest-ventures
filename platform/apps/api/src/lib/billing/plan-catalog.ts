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
 * `competitors_tracked` / `queries_per_query_set` /
 * `prompt_model_executions_per_month` are LOAD-BEARING REGRESSION VALUES —
 * `entitlements.test.ts` hard-codes these exact numbers per tier. Do not
 * change one without re-running that suite.
 *
 * COST-METERING FOLLOW-UP: `ai_queries_per_month` was RENAMED to
 * `prompt_model_executions_per_month` and its numbers corrected (Pro's old
 * 10,000 was breached by its own first baseline run), and two DOLLAR keys
 * (`ai_cost_budget_usd_per_month`, `max_cost_per_run_usd`) were added. See
 * `PlanLimits` below for the full reasoning, and re-run
 * `pnpm --filter @bebest/api run seed:plans` in every environment — a
 * `plans` row seeded before the rename is normalized at read time
 * (`lib/entitlements.ts`) but carries the old, too-low number.
 */

export const PLAN_TIERS = ['free', 'starter', 'growth', 'pro', 'agency', 'managed', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanLimits {
  /** `null` means unlimited. Epics 2/5/7's original three keys. */
  competitors_tracked: number | null;
  queries_per_query_set: number | null;
  /**
   * THE CORRECTED BILLING UNIT. One unit = one PROMPT SENT TO ONE MODEL.
   *
   * This replaces `ai_queries_per_month`, whose NAME lied about what it
   * counted. The counter behind it (`lib/ai-visibility/usage.ts`, summing
   * `ai_runs.total_jobs`) was always `queries x providers` — i.e. already
   * prompt-model executions — but the name read as "queries", and the
   * seeded numbers were set as if it were. A Pro baseline is 1,400 prompts
   * x 4 models = 5,600 executions for the brand ALONE, and Epic 8 re-runs
   * the same universe per competitor (3 competitors ~ 22,400), so Pro's old
   * `ai_queries_per_month: 10000` was breached by its own first baseline
   * run. The unit was wrong, not just the number.
   *
   * Extraction calls (`taskDefaults.extraction` -> Ollama, self-hosted) are
   * NOT counted here: this cap exists to bound VENDOR-billed fan-out, and
   * `ai_runs.total_jobs` — the counter — has never included them.
   */
  prompt_model_executions_per_month: number | null;
  /**
   * @deprecated Wrong unit name for `prompt_model_executions_per_month`
   * (see above). NOT part of any seeded row any more, and no code checks
   * it. It survives only in the TYPE so `resolvePlanLimits` can normalize a
   * `plans.limits` JSONB row that was seeded BEFORE this rename (staging
   * has such rows) into the new key instead of silently resolving to
   * "unlimited" — failing open on a spend cap is the one outcome worse than
   * a wrong cap. Remove once every environment has been re-seeded.
   */
  ai_queries_per_month?: number | null;
  /**
   * DOLLARS, not counts — the ceiling on vendor AI spend (`ai_usage.cost_usd`)
   * an org may accrue in one UTC calendar month. A frontier-model call costs
   * ~20x a cheap one and both count as one execution, so an execution cap
   * alone cannot bound spend; this is what actually bounds it. Enforced by
   * `lib/ai-usage/cost-entitlements.ts`, NEVER by `checkUsageLimit` (which
   * is integer-count arithmetic — see `NumericPlanLimitKey` below).
   *
   * PROVISIONAL. A defensible number is `list price x target gross margin`,
   * and BILLING_ARCHITECTURE.md says outright that prices are UNDECIDED.
   * These are cost CEILINGS chosen to fund the tier's documented workload
   * (a full baseline is ~$80-250 in model spend), not derived from revenue.
   * Revisit the moment `plans.price_monthly` stops being NULL.
   */
  ai_cost_budget_usd_per_month: number | null;
  /**
   * DOLLARS — the ceiling on the PROJECTED cost of a single run, checked
   * pre-flight by `lib/ai-usage/run-cost-estimator.ts` before the job is
   * queued. Distinct from the monthly budget on purpose: the monthly one
   * stops the slow leak, this one stops a single mis-sized run (a 5,000-query
   * universe x 4 frontier models) from consuming the whole month in one
   * dispatch.
   */
  max_cost_per_run_usd: number | null;
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
export type NumericPlanLimitKey = Exclude<
  keyof PlanLimits,
  'agents' | 'white_label' | 'ai_queries_per_month' | CostPlanLimitKey
>;

/** The DOLLAR-valued limit keys. Excluded from `NumericPlanLimitKey` for the
 * same compile-time reason `agents`/`white_label` are: `checkUsageLimit`'s
 * `current + increment > limit` is integer-count arithmetic against an
 * `Int` row count, and running it against fractional dollars would round
 * money. `checkAiRunCostBudget` (`lib/ai-usage/cost-entitlements.ts`) works
 * in exact BigInt micro-dollars instead, so
 * `checkUsageLimit(org, 'ai_cost_budget_usd_per_month', ...)` is a compile
 * error rather than a silently-wrong invoice. */
export type CostPlanLimitKey = 'ai_cost_budget_usd_per_month' | 'max_cost_per_run_usd';

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
      // 50 queries x 4 models = exactly one free-tier sample run (see docs/11-geo/GEO_ENGINE.md).
      prompt_model_executions_per_month: 200,
      ai_cost_budget_usd_per_month: 15,
      max_cost_per_run_usd: 6, // one 50-query run projects ~$3; 2x headroom on profile error
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
      // 200 x 4 = 800 per run -> 4 runs/month, matching snapshots_per_month: 4.
      prompt_model_executions_per_month: 3200,
      ai_cost_budget_usd_per_month: 100,
      max_cost_per_run_usd: 30, // 4 runs x 200 queries projects ~$48
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
      // 500 x 4 = 2,000 per run -> 6 runs/month (brand + competitors).
      prompt_model_executions_per_month: 12000,
      ai_cost_budget_usd_per_month: 350,
      max_cost_per_run_usd: 80, // 6 runs x 500 queries projects ~$180
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
      // 1,400 x 4 = 5,600 for the brand baseline; 3 competitors ~ 22,400. Funds two full baselines plus weekly monitoring — the old 10,000 could not fund ONE.
      prompt_model_executions_per_month: 60000,
      ai_cost_budget_usd_per_month: 1200,
      max_cost_per_run_usd: 300, // 10 baselines x 1,400 queries projects ~$900 — the EXECUTION cap binds first, this is the backstop
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
      // Multi-client by definition (client_accounts: 20) — a flat pool large enough that a per-client shape (Epic 18) is what actually apportions it.
      prompt_model_executions_per_month: 300000,
      ai_cost_budget_usd_per_month: 6000,
      max_cost_per_run_usd: 1000, // multi-client pool; the per-client shape (Epic 18) apportions it
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
      // Custom-negotiated tier — unlimited, same treatment as every other numeric key here.
      prompt_model_executions_per_month: null,
      ai_cost_budget_usd_per_month: null,
      max_cost_per_run_usd: null,
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
      // Custom-negotiated tier — unlimited, same treatment as every other numeric key here.
      prompt_model_executions_per_month: null,
      ai_cost_budget_usd_per_month: null,
      max_cost_per_run_usd: null,
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
