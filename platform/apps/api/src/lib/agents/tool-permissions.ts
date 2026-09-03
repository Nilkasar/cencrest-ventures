/**
 * Epic 12 — the real, checked tool-use allowlist per agent type
 * (`docs/13-agents/AGENT_ARCHITECTURE.md`'s "Tool Use" table), enforced as
 * code (`canPerform()` on every concrete agent below, and every route that
 * would act on a pending action), not documentation. Every concrete agent's
 * `canPerform` delegates to `canPerformTool` — there is exactly one place
 * this table is consulted.
 */
import type { Action, AgentName, ToolName } from './types.js';

/** `docs/13-agents/AGENT_ARCHITECTURE.md`'s per-tool "Permission" column,
 * transcribed. `query_database`/`send_notification`/`crawl_url`/
 * `search_web` are genuinely "All agents"; the rest are agent-type-specific.
 * `create_content_draft`/`publish_content` are listed there under "Content
 * agent" only (a fourth agent type this epic does not implement) — see
 * `PROHIBITED_FOR_ALL` below for why they are hard-blocked for all three
 * agents this epic DOES implement, regardless of this table. */
const TOOL_PERMISSIONS: Record<AgentName, ReadonlySet<ToolName>> = {
  geo_agent: new Set<ToolName>([
    'crawl_url',
    'search_web',
    'run_ai_query',
    'query_database',
    'create_recommendation',
    'create_content_brief',
    'send_notification',
  ]),
  seo_agent: new Set<ToolName>([
    'crawl_url',
    'search_web',
    'analyze_page',
    'query_database',
    'create_recommendation',
    'create_content_brief',
    'send_notification',
  ]),
  growth_agent: new Set<ToolName>([
    'crawl_url',
    'search_web',
    'run_ai_query',
    'analyze_page',
    'query_database',
    'create_recommendation',
    'create_content_brief',
    'send_notification',
  ]),
};

/**
 * Hard-blocked for EVERY agent this epic implements, at EVERY autonomy
 * level, unconditionally — checked BEFORE the per-agent allowlist above, so
 * nothing can add one of these back by editing `TOOL_PERMISSIONS`.
 *
 * - `modify_billing` / `change_user_permissions` / `access_other_org_data` /
 *   `send_external_email` — this epic's own hard constraints, verbatim
 *   ("Hard-block, at the code level: billing changes, permission changes,
 *   cross-org data access, unapproved external communication"), matching
 *   AGENT_ARCHITECTURE.md's "Agents cannot" list.
 * - `create_content_draft` / `publish_content` — AGENT_ARCHITECTURE.md
 *   scopes both to the "Content agent" (Epic 11/13's Content Agent, not
 *   built by this epic) and, for `publish_content`, explicitly to "Level
 *   3+ only." This epic's own brief is explicit that it "stops at
 *   'approved, ready for Epic 13 to execute'" — no code path in this build
 *   ever calls `publish_content`, so it is blocked here rather than
 *   half-wired behind a level check this epic has no way to fully honor
 *   (there is no actual publish mechanism for it to gate).
 */
const PROHIBITED_FOR_ALL: ReadonlySet<ToolName> = new Set<ToolName>([
  'modify_billing',
  'change_user_permissions',
  'access_other_org_data',
  'send_external_email',
  'create_content_draft',
  'publish_content',
]);

export function canPerformTool(agentName: AgentName, action: Action): boolean {
  if (PROHIBITED_FOR_ALL.has(action.tool)) return false;
  return TOOL_PERMISSIONS[agentName].has(action.tool);
}

export function allowedToolsFor(agentName: AgentName): ToolName[] {
  return [...TOOL_PERMISSIONS[agentName]];
}
