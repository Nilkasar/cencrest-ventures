# Epic 12 — GEO Agent + SEO Agent + Growth Agent (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
nothing under `api/`, `web-app/`, the repo-root marketing site, or
`platform/packages/*` was touched. No git commands were run, no database
was connected to, no real network call to any AI/external provider was
made — every request goes to `platform/apps/api`'s real Epic 12 routes
(already built, documented in `docs/epics/12-agents-backend.md`, and
re-verified directly against `routes/agents.ts`/`routes/agent-run-details.ts`/
`lib/agents/{types,serialize}.ts` before writing this frontend, not guessed
from that doc's prose) via `src/lib/api-client.ts`, no fixture layer, from
the first line.

## What was built

### Data layer (`src/data/agents/`)

- **`types.ts`** — `AgentName`, `AgentRunStatus`, `TriggeredBy`,
  `AutonomyLevel` (`1 | 2 | 3` — 4 is never a representable value in this
  package, matching the backend's own type-level narrowing in
  `lib/agents/types.ts`), `AgentEventType`, `ToolName`, `AgentRun`,
  `AgentEvent`, `AgentPendingAction`, `AgentRunDetail`. Mirrors
  `apps/api/src/lib/agents/serialize.ts` field-for-field — every field is
  camelCase because the API already returns a camelCase, whitelisted
  object, same "comes across as-is" convention `data/opportunities/types.ts`
  documents. `evidence`/`payload` stay open `Record<string, unknown>` (not a
  discriminated union) because the backend itself treats them as open JSONB.
- **`labels.ts`** — `AGENT_NAME_LABEL`/`_DESCRIPTION`,
  `AGENT_RUN_STATUS_LABEL`/`_BADGE_VARIANT`, `AUTONOMY_LEVEL_LABEL`/
  `_DESCRIPTION` (only levels 1-3 — no label exists for 4 anywhere in this
  module, so there is nothing a UI control could even render as a "level 4"
  choice), `AGENT_EVENT_TYPE_LABEL`/`_BADGE_VARIANT`,
  `PENDING_ACTION_STATUS_LABEL`/`_BADGE_VARIANT`.
- **`client.ts`** —
  - `listAgentRuns()` — `GET /brands/me/agents`, 404 (no brand yet) degrades
    to `[]`, same "let the empty state carry it" precedent
    `listOpportunities`/`listRecommendations` use.
  - `triggerAgentRun(agentName, autonomyLevel = 1)` — `POST
    /brands/me/agents/:agentName/run`. Defaults to Level 1 (Recommend) when
    the caller passes nothing — the safest choice, never silently escalated.
    Translates the four typed failure shapes the backend documents:
    `AgentsNotAvailableError` (402 `agents_not_available`),
    `AgentRunLimitError` (402 `agent_run_limit_reached`, carries
    `limit`/`current`/`plan`/`upgradeTo` exactly like `AiQueryLimitError`),
    `AutonomyLevelRejectedError` (422 `autonomy_level_rejected` — the HTTP
    surface of the Level-4 hard block; unreachable from this UI's own
    controls, only from a hostile/malformed request), `NoBrandProfileError`
    (plain 404).
  - `getAgentRun(id)` — `GET /agent-runs/:id`, throws
    `AgentRunNotFoundError` on 404 (tenant isolation: a foreign id 404s,
    never a 403 that would confirm existence).
  - `approvePendingAction(agentRunId)` — `POST /agent-runs/:id/approve`,
    throws `NoPendingActionError` (404 `no_pending_action`) vs.
    `AgentRunNotFoundError` (any other 404), distinguished by the response
    body's `error` code.
  - `pendingActionRecommendationId(pending)` — reads a `create_content_brief`
    pending action's `recommendationId` back out of its open `payload`
    JSONB (the real shape `geo-agent.ts`/`seo-agent.ts` write, read
    directly from source, not guessed).
  - `listPendingActionsByRecommendationId()` — the join that lets the
    Opportunities/Recommendations screens surface a pending approval
    inline. See "Known limitations" below for why this is an N+1 fetch over
    a small, recent window rather than a single request — there is no
    `GET`-all-pending-actions route; the backend's own API surface only
    ever returns pending actions nested under one run
    (`GET /agent-runs/:id`).

### UI

- **`src/hooks/use-agent-run.ts`** (new) — loads one run's full detail then
  polls it every 2s while `queued`/`running`, stopping the instant it
  reaches a terminal status. Directly adapted from `use-ai-run.ts`'s
  identical shape (Epic 7), itself adapted from `use-crawl-job.ts` (Epic 3)
  — the same "poll while non-terminal, re-fetch the full resource each
  tick" pattern this epic's UI-surface requirement calls for.
- **`src/hooks/use-agent-runs.ts`** (new) — the run-history list, built on
  `useAsyncData` plus a coarser 4s poll that only runs while at least one
  row in the list is still `queued`/`running` (so a completed run's row
  flips status without a manual refresh, without polling forever once
  everything has settled).
- **`src/components/agents/agent-trigger-card.tsx`** (new) — one agent's
  trigger control: name, description, an autonomy-level `<Select>` that
  only ever lists `AUTONOMY_LEVELS` (`[1, 2, 3]` — 4 is not a renderable
  option, period), and a "Run" button.
- **`src/components/agents/agents-view.tsx`** (new) — the main `/agents`
  screen: three `AgentTriggerCard`s (GEO/SEO/Growth) side by side, then the
  run-history table (`useAgentRuns`) — agent, status badge, `stepsCompleted/
  totalSteps`, autonomy level, `triggeredBy`, relative start time. Clicking
  a row (or pressing Enter on it, same `role="link"`/`tabIndex`/`onKeyDown`
  convention `accounts-view.tsx` already established) navigates to
  `/agents/:id`. Triggering a run toasts, reloads the history, and
  navigates straight into the new run's live detail view.
- **`src/components/agents/agent-evidence.tsx`** (new) — renders one
  event's `evidence`/`payload` JSONB as a real key -> value disclosure
  (never re-narrated as prose, per this epic's "real evidence, not a vague
  string" requirement), with known id keys (`aiRunId`, `querySetId`,
  `opportunityId`, `recommendationId`, `brandId`) linked straight to the
  screen that owns that data. There is no per-id detail route for an AI
  run/opportunity/recommendation/query set anywhere in this app (Epics
  5/7/9/10 each show their data on one list screen, not a `/thing/:id`
  page) — a "real evidence link" here means "the screen where this id's row
  actually lives," which is what those five links resolve to; it is not a
  broken/aspirational deep link to a route that doesn't exist.
- **`src/components/agents/agent-event-item.tsx`** (new) — one row of the
  append-only event stream: a type icon + badge, the step counter when
  present, a timestamp, the event's real `message` (the backend's own
  `decomposeEvent` already turns every event type — progress/observation/
  recommendation/draft/action_required/complete/error — into one real
  string; this component never re-derives that text), and its evidence via
  `AgentEvidence`.
- **`src/components/agents/pending-action-panel.tsx`** (new) — Level 3's
  one-click approval, built once and used in three places (the run detail
  view, `recommendation-card.tsx`, and `next-action-panel.tsx`) rather than
  three copies. Shows the action's title/description, a status badge
  (`Awaiting approval`/`Approved`/`Rejected`), and — only while `pending` —
  an "Approve" button plus an explicit "This never publishes anything on
  its own" line, since approving here really does stop at "approved, ready
  for Epic 13 to execute" (this epic's own explicit brief; the frontend
  copy says so rather than implying otherwise). Once approved, shows the
  approval date and the 30-day rollback window's end date.
- **`src/components/agents/agent-run-detail-view.tsx`** (new) — the
  live-updating run view (`docs/epics/12-agents.md`'s literal UI-surface
  requirement). Header (agent name, autonomy level, triggered-by, started
  time), a status card with a live "updating every 2s…" indicator while
  non-terminal and a step-progress bar, an inline failure panel when
  `run.error` is set, any pending actions (`PendingActionPanel`, before the
  event log — the one thing a viewer most likely came here to act on), then
  the full append-only event log (`AgentEventItem` per row, in creation
  order, never reordered).
- **`src/app/(app)/agents/page.tsx`** (new) — renders `AgentsView`,
  `metadata.title = "Agents"`.
- **`src/app/(app)/agents/[id]/page.tsx`** (new) — the async-`params`
  pattern this Next.js version (16.3.3) requires (`params: Promise<{ id:
  string }>`, `await`ed before use), matching
  `crm/deals/[id]/page.tsx`/`content/drafts/[id]/page.tsx`'s identical
  shape. Renders `AgentRunDetailView`.
- **`src/data/nav.ts`** (extended) — added `{ href: "/agents", label:
  "Agents", icon: Bot }` to the "Execution" group, right after
  "Recommendations" (the screen whose output an agent run most directly
  feeds) and before "Actions" (Epic 13, not yet built). No `epic:` marker —
  real, wired data today, same convention Epic 10's own nav entry followed.

### Extending Epic 9/10's screens for inline Level 3 approval (per this
epic's explicit UI-surface instruction: "reuse Epic 9/10's Opportunities/
Recommendations screens rather than building a separate approval inbox")

- **`src/components/recommendations/recommendation-card.tsx`** (extended)
  — now accepts optional `pendingAction`/`onApprovePendingAction` props and
  renders `PendingActionPanel` (compact) right after the evidence-summary
  block when present. Nothing else about the card changed.
- **`src/components/recommendations/next-action-panel.tsx`** (extended) —
  same two optional props, same `PendingActionPanel` (compact) placement,
  so the identical inline approval also appears on the Opportunities
  screen's embedded "next action" panel, not just the standalone
  Recommendations screen.
- **`src/components/opportunities/opportunity-card.tsx`** (extended) —
  threads `pendingAction`/`onApprovePendingAction` straight through to its
  `NextActionPanel`. Nothing about the opportunity's own status control,
  dismiss-reason flow, or score tiles changed.
- **`src/components/recommendations/recommendations-view.tsx`** and
  **`src/components/opportunities/opportunities-view.tsx`** (both
  extended) — each independently fetches
  `listPendingActionsByRecommendationId()` (via `useAsyncData`, same base
  every list screen uses), builds a `recommendationId -> {pendingAction,
  agentRunId}` map, and passes each row's match (if any) down. Approving
  calls `approvePendingAction(agentRunId)`, toasts, and reloads only the
  pending-actions map (not the whole opportunities/recommendations list —
  approving never changes a recommendation's own fields). Two independent
  fetches (one per screen), same "each screen owns its own joins" precedent
  Epic 10's frontend doc already established for
  `listRecommendations`/`listOpportunities`.

## Design decisions worth naming

1. **Level 4 is not a reachable value anywhere in this codebase's frontend
   — not a hidden option, not a disabled one, absent.** `AutonomyLevel` is
   `1 | 2 | 3` at the type level (`data/agents/types.ts`), `AUTONOMY_LEVELS`
   is `[1, 2, 3]`, `AUTONOMY_LEVEL_LABEL`/`_DESCRIPTION` have no `4` key,
   and `agent-trigger-card.tsx`'s `<Select>` maps only over
   `AUTONOMY_LEVELS`. The real hard-block still lives entirely server-side
   (`lib/agents/autonomy.ts`) — this is defense-in-depth on the UI layer,
   not a substitute for it, and `AutonomyLevelRejectedError` exists
   precisely because a hostile client could still send `4` directly.
2. **One reusable `PendingActionPanel`, not three copies.** The exact same
   component (and the exact same "Approve" call) appears on the run detail
   view, the Opportunities screen, and the Recommendations screen — a
   viewer who approves a Level 3 action from any of the three sees
   identical copy and identical behavior, and a future change to how
   approval is presented only has one file to edit.
3. **No separate "approval inbox" screen was built, per the epic's literal
   instruction.** The only place a pending action is visible outside of
   inline-on-Opportunities/Recommendations is the run detail view itself
   (`/agents/:id`) — which already exists for a different reason (the live
   event log) and simply also happens to show the run's own pending action,
   not a second purpose-built inbox.
4. **"Approve" copy is explicit that nothing gets published.** Every
   `PendingActionPanel` instance states "This never publishes anything on
   its own" (or the run-detail toast's equivalent) rather than leaving a
   viewer to assume approval = execution — matching this epic's own hard
   requirement that it stops at "approved, ready for Epic 13 to execute."
5. **Evidence links point at screens, not synthetic per-id routes.**
   `agent-evidence.tsx` deliberately does not invent a `/ai-runs/:id` or
   `/opportunities/:id` route that doesn't exist elsewhere in this app just
   to make an evidence link feel more specific — it links to the real
   screen that owns that id's data, matching how every other epic in this
   app actually organizes its screens (one list view per resource, not a
   detail route per row, for AI runs/opportunities/recommendations/query
   sets specifically).
6. **The run-history list polls, but coarser than a single run's own
   detail poll.** 4s vs. 2s — this list only needs to notice a status flip,
   not track step-by-step progress (that's what clicking into the run
   detail view is for), so it doesn't need the same resolution.

## Known limitations (documented, not silently skipped)

1. **`listPendingActionsByRecommendationId` is an N+1 fetch over a bounded,
   recent window, not a single request.** There is no `GET`-all-pending-
   actions route anywhere in this epic's backend — the only route that
   returns a pending action at all is `GET /agent-runs/:id`, scoped to one
   run. Surfacing "wherever a pending action appears" on the Opportunities/
   Recommendations screens therefore means: list this brand's agent runs,
   filter to `autonomyLevel === 3` (the only runs that could possibly have
   created one — deliberately not also filtered to `status === 'completed'`,
   since the runner persists the pending-action row a moment before the run
   itself flips to `completed`), take the most recent 10
   (`PENDING_ACTION_SCAN_LIMIT`), and fetch each one's full detail in
   parallel. A run detail fetch that fails is swallowed (best-effort, not
   this screen's primary data) rather than failing the whole screen. If a
   brand's pending action ever falls outside the 10 most recent Level-3
   runs, it won't surface inline — reachable only once a brand has
   triggered agents very heavily, not in any state this build's manual
   verification could produce. Flagged rather than silently assumed away,
   same convention Epic 10's frontend doc used for its own join limitation.
2. **Two independent joins for the same pending-action data**
   (`opportunities-view.tsx` and `recommendations-view.tsx` each call
   `listPendingActionsByRecommendationId()` separately) rather than a
   shared cache. Same "each screen owns its own joins" precedent Epic 10's
   frontend already established for `listRecommendations`; a shared
   client-side cache would be a real improvement but isn't this epic's
   scope to introduce app-wide.
3. **No UI for `triggered_by: 'schedule'|'event'`.** The backend itself
   only ever creates `triggered_by: 'user'` runs today (no
   cron/queue infrastructure exists anywhere in this codebase — the
   backend's own completion doc documents this as a backend gap, not a
   frontend one) — there is nothing yet for a frontend to trigger or
   display for those two values beyond the plain `triggeredBy` label
   already shown in the history table.
4. **No rejection action for a pending action.** The backend's own API
   surface has no `reject` endpoint (`agent_pending_actions.status` can be
   `'rejected'` at the schema level, but no route this epic's backend
   built ever writes it) — only "Approve" exists in this UI because only
   approve exists to call.
5. **No automated frontend tests** — `@bebest/web` has no test runner
   configured for any screen in this codebase (checked: no `*.test.*`
   files anywhere under `apps/web/src`, no `test` script in
   `apps/web/package.json`), so this epic's frontend work follows the same
   convention as every other already-shipped `apps/web` epic. Verified
   instead via `typecheck`/`lint`/`build`, all clean (see below).

## Verification

- `pnpm --filter web typecheck` (`tsc --noEmit`) — clean.
- `pnpm --filter web lint` (`eslint .`) — clean.
- `pnpm --filter web build` (`next build`) — clean; the route table
  includes the new `○ /agents` and `ƒ /agents/[id]` routes alongside every
  pre-existing route, none of which regressed.
- `pnpm --filter web test` — no task configured (see "Known limitations"
  #5), consistent with the rest of this app.
- Manually traced against the backend's actual route/serializer/type source
  (`routes/agents.ts`, `routes/agent-run-details.ts`,
  `lib/agents/{types,serialize}.ts`, `geo-agent.ts`'s literal
  `action_required` payload shape) field-for-field before writing
  `data/agents/types.ts`/`client.ts`, not guessed from
  `docs/epics/12-agents-backend.md`'s prose alone.

## Files touched

New:
- `platform/apps/web/src/data/agents/{types,labels,client}.ts`
- `platform/apps/web/src/hooks/use-agent-run.ts`
- `platform/apps/web/src/hooks/use-agent-runs.ts`
- `platform/apps/web/src/components/agents/{agent-trigger-card,agents-view,agent-evidence,agent-event-item,pending-action-panel,agent-run-detail-view}.tsx`
- `platform/apps/web/src/app/(app)/agents/page.tsx`
- `platform/apps/web/src/app/(app)/agents/[id]/page.tsx`
- `platform/docs/epics/12-agents-frontend.md` (this file)

Extended (Epic 9/10's files, per this epic's explicit "extend rather than
build a separate inbox" instruction — no other behavior in any of these
files changed):
- `platform/apps/web/src/components/recommendations/recommendation-card.tsx`
- `platform/apps/web/src/components/recommendations/next-action-panel.tsx`
- `platform/apps/web/src/components/recommendations/recommendations-view.tsx`
- `platform/apps/web/src/components/opportunities/opportunity-card.tsx`
- `platform/apps/web/src/components/opportunities/opportunities-view.tsx`
- `platform/apps/web/src/data/nav.ts`
