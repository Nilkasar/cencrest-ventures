# Epic 12 — GEO Agent + SEO Agent + Growth Agent (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 7 (AI Visibility), Epic 4 (SEO), Epic 9 (Opportunity Engine), Epic 10 (Recommendations) — this epic orchestrates all of them into autonomous, observable runs.

## Why this epic

`docs/13-agents/AGENT_ARCHITECTURE.md` is explicit: agents are not a new capability, they are an **orchestration and observability layer** over engines that already exist (GEO Agent = Epic 7's pipeline + Epic 8's competitive analysis + Epic 9's gap identification, run end-to-end on a schedule or on demand, with a visible step-by-step event log). Building this before Epics 7-9 existed would have meant guessing at what there was to orchestrate — it now has real engines to wrap.

## Domain model

- `agent_runs` — `agent_name` (`geo_agent|seo_agent|growth_agent`), `agent_version`, `organization_id`, `brand_id`, `triggered_by` (`user|schedule|event`), `triggered_by_id`, `status`, `steps_completed`/`total_steps`, `tokens_used`, `latency_ms`, `result_id`, `error`.
- `agent_events` — append-only event log per run: `type` (`progress|observation|recommendation|draft|action_required|complete|error`), `message`, `step`, `evidence` (nullable), `created_at`. This IS the "customers can see what the agent did, step-by-step" transparency `AGENT_ARCHITECTURE.md` calls "a trust differentiator" — build it as a genuine append-only stream, not a single mutable status field.

## Agent structure (implement the exact interface from `docs/13-agents/AGENT_ARCHITECTURE.md`)

```typescript
interface Agent {
  name: string; version: string; autonomyLevel: 1|2|3|4;
  run(context: AgentContext): AsyncGenerator<AgentEvent>;
  canPerform(action: Action): boolean;
}
```
Each concrete agent's `run()` is a thin orchestrator calling already-built engine functions in sequence, yielding an `AgentEvent` at each real step (not synthetic progress) — e.g. GEO Agent: profile (read Epic 2 brand) → generate query universe (Epic 5, if none active) → run AI visibility (Epic 7) → diagnose gaps (Epic 8/9) → recommend (Epic 10) → done. Every step's event includes real evidence (an ID/link into the underlying engine's own data), not a vague string.

## Autonomy levels — implement 1-3 fully, hard-block 4

Per `docs/13-agents/AGENT_ARCHITECTURE.md`: **Level 4 is explicitly out of scope for this phase** ("designed for Phase 10") — the code should make Level 4 literally unreachable (a hard-coded rejection, not just an unset config flag), not a half-wired feature. Levels 1 (Recommend) and 2 (Draft) require no new mechanics beyond what Epics 9/10 already do when agent-triggered. Level 3 (Approve & Execute) needs an explicit one-click approval endpoint and a 30-day rollback window — build the approval/audit mechanics now; actual "execute" (publishing) is Epic 13's job, this epic stops at "approved, ready for Epic 13 to execute."

## Tool-use permission list (`docs/13-agents/AGENT_ARCHITECTURE.md`, enforce as code, not documentation)

Agents run as `system` role (never as a user — reuse Epic 0's RBAC `system` role). Hard-block, at the code level: billing changes, permission changes, cross-org data access, unapproved external communication. The permission list per tool (`crawl_url`, `run_ai_query`, `create_recommendation`, `publish_content` Level 3+ only, etc.) should be a real, checked allowlist per agent type, not convention.

## Prompt injection protection (carries forward Epic 6/3's existing discipline)

Agents already never execute crawled/AI-response content as instructions (Epic 3/7 built this correctly) — this epic's job is to make sure the AGENT layer itself doesn't introduce a new injection surface: tool outputs formatted as data blocks in agent prompts, never string-concatenated as if they were instructions.

## API surface

- `POST /brands/:id/agents/:agentName/run` — trigger (user or schedule), entitlement-checked (`agent_runs_per_month` per `docs/16-billing/BILLING_ARCHITECTURE.md`, real now via Epic 16).
- `GET /agent-runs/:id` — status + full event stream.
- `POST /agent-runs/:id/approve` (Level 3 actions only) — audit-logged.

## UI surface

A live-updating run view (step list with real evidence links, matching the transparency principle), an agent-runs history list per brand, and Level 3's one-click approval surfaced inline wherever a pending action appears (reuse Epic 9/10's Opportunities/Recommendations screens rather than building a separate approval inbox).

## End-to-end flow (qa-flow-tester must trace every step below, not just each agent method in isolation)

1. Trigger the GEO Agent on demand — confirm each yielded event corresponds to a REAL underlying call (Epic 5's generator, Epic 7's pipeline, Epic 8's gap analysis, Epic 9's recompute, Epic 10's recommendation generation) in the correct order, not a synthetic/simulated step list.
2. Confirm entitlement is checked before the run starts (reusing Epic 16's real plan data), and that exceeding `agent_runs_per_month` produces the same typed-error pattern as every other entitlement check in the system.
3. Attempt to configure/trigger Level 4 — confirm it is rejected at the code level regardless of any config value (test this explicitly, not just "it's not in the UI").
4. A Level 3 action reaches `action_required` — a user approves it — confirm the approval is audit-logged and the action's status flips to approved (execution itself is Epic 13's job — confirm this epic does NOT publish anything).
5. Feed a crawled page (Epic 3) containing an obvious prompt-injection string into an agent run that touches it — confirm the agent's own event log/recommendation output does not follow the injected instruction (e.g. does not recommend something the injected text demanded).
6. Tenant isolation check across `agent_runs`/`agent_events`.

## Definition of done

Standard DoD. A test proving Level 4 is unreachable under every input combination tried, not just the documented default.
