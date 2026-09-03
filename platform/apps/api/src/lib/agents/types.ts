import type { AIProviderRegistry } from '@bebest/ai-provider';

/**
 * Epic 12 (GEO Agent / SEO Agent / Growth Agent) — the `Agent` interface,
 * transcribed EXACTLY from `docs/13-agents/AGENT_ARCHITECTURE.md`'s "Agent
 * Structure" section (field names, method signatures, and the `AgentEvent`
 * discriminated union all match verbatim), plus the small set of supporting
 * types this codebase's actual engines need to fill `AgentContext` in.
 *
 * One deliberate, documented narrowing vs. the doc's literal
 * `autonomyLevel: 1 | 2 | 3 | 4`: this package's own `AutonomyLevel` type is
 * `1 | 2 | 3` — level 4 is out of scope for this phase per
 * AGENT_ARCHITECTURE.md itself ("Level 4 is NOT available in Phase 1–6... it
 * is designed for Phase 10") and this epic's own hard requirement ("Level 4
 * must be hard-blocked at the code level under every input combination").
 * Narrowing the TYPE is one layer of that defense (a concrete `Agent`
 * instance's `autonomyLevel` field can never even be ASSIGNED 4 without a
 * type error) on top of the runtime guard in `autonomy.ts` (which is the
 * layer that actually matters — see that file's header comment for why the
 * type alone would not be enough).
 */

/** The three agents this epic implements. Not a native enum — kept as a
 * plain string union matching `agent_runs.agent_name`'s VARCHAR+CHECK
 * column exactly (see `@bebest/database`'s schema comment on that table for
 * why: a later phase's Content/Research/Competitor/Measurement agent, per
 * AGENT_ARCHITECTURE.md's full seven-agent-type list, should never need a
 * schema migration to widen a Postgres ENUM). */
export type AgentName = 'geo_agent' | 'seo_agent' | 'growth_agent';

export const AGENT_NAMES: readonly AgentName[] = ['geo_agent', 'seo_agent', 'growth_agent'];

/** See this file's header comment — 4 is deliberately absent from this
 * union. */
export type AutonomyLevel = 1 | 2 | 3;

export type TriggeredBy = 'user' | 'schedule' | 'event';

/**
 * The ten tools AGENT_ARCHITECTURE.md's "Tool Use" table names, plus the
 * four explicitly-prohibited-category names from its "Agents cannot" list
 * (`modify_billing`/`change_user_permissions`/`access_other_org_data`/
 * `send_external_email`) — included here as first-class `ToolName` values,
 * not left as prose, specifically so `canPerform()` can be tested against
 * them directly (this epic's own requirement: "enforce as code, not
 * documentation").
 */
export type ToolName =
  | 'crawl_url'
  | 'search_web'
  | 'run_ai_query'
  | 'analyze_page'
  | 'query_database'
  | 'create_recommendation'
  | 'create_content_brief'
  | 'create_content_draft'
  | 'publish_content'
  | 'send_notification'
  | 'modify_billing'
  | 'change_user_permissions'
  | 'access_other_org_data'
  | 'send_external_email';

/** `docs/13-agents/AGENT_ARCHITECTURE.md`'s literal `Action` shape is never
 * spelled out beyond "the agent runner passes an `Action` to `canPerform`" —
 * this is the minimal, concrete shape this codebase's `canPerform`
 * implementations actually check against. */
export interface Action {
  tool: ToolName;
}

/** Mirrors `docs/13-agents/AGENT_ARCHITECTURE.md`'s `AgentContext` exactly,
 * with `aiProvider`/`db`/`logger` narrowed from the doc's illustrative
 * `AIProvider`/`Database`/`Logger` placeholders to this codebase's real
 * equivalents (`@bebest/ai-provider`'s `AIProviderRegistry` — agents resolve
 * a specific provider per task via `resolveAvailable()`/`resolveNames()`,
 * never a single bare `AIProvider` — and `console`, since no structured
 * logger exists elsewhere in this codebase to reuse). `db` is deliberately
 * OMITTED: every engine function this epic orchestrates already takes
 * `organizationId`/`brandId` and reaches `@bebest/database` itself via
 * `withOrgContext` — handing agents a raw, unscoped Prisma client here would
 * be a second, parallel way to reach the database that bypasses the very
 * tenant-isolation discipline `withOrgContext` exists to enforce, exactly
 * the "cross-org data access" this epic's hard constraints forbid.
 */
export interface AgentContext {
  organizationId: string;
  brandId: string;
  triggeredBy: TriggeredBy;
  triggeredById?: string;
  parameters: Record<string, unknown>;
  /** Resolved from `resolvePlanLimits`/`assertAutonomyLevelAllowed` by the
   * runner BEFORE `run()` is ever called — never trusted from
   * `parameters` (a caller-supplied `parameters.autonomyLevel` is never read
   * by any agent in this file for exactly that reason; see
   * `runner.ts`). */
  autonomyLevel: AutonomyLevel;
  registry: AIProviderRegistry;
  logger: Pick<Console, 'info' | 'warn' | 'error'>;
}

/** `docs/13-agents/AGENT_ARCHITECTURE.md`'s `AgentEvent` union, transcribed
 * field-for-field. `evidence` is added to every variant (not just
 * `observation`'s, which is all the doc's snippet shows) because this
 * epic's own requirement is that EVERY step's event carries real evidence,
 * not just observations — see `docs/epics/12-agents.md`'s "Agent structure"
 * section. */
export type AgentEvent =
  | { type: 'progress'; message: string; step: number; totalSteps: number; evidence?: Record<string, unknown> }
  | { type: 'observation'; observation: string; evidence?: Record<string, unknown> }
  | { type: 'recommendation'; recommendation: { id: string; title: string }; evidence?: Record<string, unknown> }
  | { type: 'draft'; content: { id: string; title: string }; evidence?: Record<string, unknown> }
  | {
      type: 'action_required';
      action: { actionType: ToolName; title: string; description: string; payload: Record<string, unknown> };
      evidence?: Record<string, unknown>;
    }
  | { type: 'complete'; summary: string; resultId: string }
  | { type: 'error'; message: string; fatal: boolean };

/** `docs/13-agents/AGENT_ARCHITECTURE.md`'s `Agent` interface, verbatim. */
export interface Agent {
  readonly name: AgentName;
  readonly version: string;
  readonly autonomyLevel: AutonomyLevel;
  run(context: AgentContext): AsyncGenerator<AgentEvent>;
  canPerform(action: Action): boolean;
}
