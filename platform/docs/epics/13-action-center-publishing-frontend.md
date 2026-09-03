# Epic 13 — Action Center & Controlled Publishing (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
nothing under `api/`, `web-app/`, the repo-root marketing site, or
`platform/packages/*` was touched. No git commands were run, no database
was connected to, no real network call to any external provider was made —
every request goes to `platform/apps/api`'s real Epic 13 routes (already
built, documented in `docs/epics/13-action-center-publishing-backend.md`,
and re-verified directly against `routes/actions.ts`/`routes/
action-details.ts`/`lib/actions/{serialize,publish-target,rollback-window}.ts`
before writing this frontend, not guessed from that doc's prose) via
`src/lib/api-client.ts`, no fixture layer, from the first line.

## What was built

### Data layer (`src/data/actions/`)

- **`types.ts`** — `ActionStatus` (`pending | approved | completed |
  rolled_back` — the real, widened lifecycle from `checks.sql`'s
  `chk_actions_status`, not Epic 0's placeholder), `ActionPriority`,
  `ActionAutonomyLevel` (`1 | 2 | 3 | 4` — deliberately NOT narrowed to
  `1-3` the way Epic 12's own `AutonomyLevel` safely is: this epic's own
  non-negotiable requires the Level 4 block be provable even against a row
  that legitimately holds `4`, so the type stays able to represent one),
  `ActionResult`, `Action`, `ActionWithContext` (extends `Action` with
  `contentDraft`/`contentBrief`, reusing Epic 11's own `ContentDraft`/
  `ContentBrief` types rather than re-declaring them — `GET
  /brands/me/actions` inlines the exact same shape), `ActionsOverview`,
  `PublishedContent`, `ApproveActionResult`, `ExecuteActionResult`,
  `RollbackActionResult`. Mirrors `apps/api/src/lib/actions/serialize.ts`
  and both route files field-for-field.
- **`labels.ts`** — `ACTION_STATUS_LABEL`/`_BADGE_VARIANT`,
  `ACTION_PRIORITY_LABEL`/`_BADGE_VARIANT`, `actionTypeLabel()` (known
  values + an open, humanized fallback — same convention `contentTypeLabel`
  already uses), `autonomyLevelLabel()` (levels 1-3 reuse Epic 12's own
  ladder; level 4 gets its own "blocked" label).
- **`rollback-window.ts`** — a client-side MIRROR of the backend's own
  `lib/actions/rollback-window.ts` (same 30-day constant, same
  `executed_at`-based math), used only to decide whether to show/enable the
  "Roll back" button. The real enforcement stays the server's guard clause;
  a stale client still gets a real 409 back.
- **`client.ts`** —
  - `getActionsOverview()` — `GET /brands/me/actions`, 404 (no brand yet)
    degrades to an all-empty overview, same "let the empty state carry it"
    precedent `listContentBriefs`/`listAgentRuns` use.
  - `approveAction(id)` — `POST /actions/:id/approve`.
  - `executeAction(id)` — `POST /actions/:id/execute`, the one and only
    call in this frontend that can ever create a `published_content` row.
  - `rollbackAction(id)` — `POST /actions/:id/rollback`.
  - Five typed errors translating the backend's real error codes:
    `ActionNotFoundError` (404), `ActionNotApprovedError` (409
    `not_approved`), `ActionNotExecutedError` (409 `not_executed`),
    `RollbackWindowExpiredError` (409 `rollback_window_expired`),
    `ActionAutonomyLevelRejectedError` (422 `autonomy_level_rejected`).
  - `agentRunIdsByPendingActionId(pendingActionIds)` — the bounded join that
    lets an agent-originated Action Center row link straight to
    `/agents/:id` instead of a dead end. See "Known limitations" below —
    this mirrors `data/agents/client.ts`'s own
    `listPendingActionsByRecommendationId` pattern (same
    `AGENT_RUN_SCAN_LIMIT = 10`, same reason: there is no `GET
    /agent-pending-actions/:id` route and `actions` itself carries no
    `agent_run_id` column, only `agent_pending_action_id`).

### UI

- **`src/components/actions/action-origin.tsx`** (new) — the underlying
  recommendation/content draft, shown inline, this epic's own literal UI
  requirement verbatim. Reads `contentDraft`/`contentBrief` straight off
  `GET /brands/me/actions`'s own response (already inlined server-side,
  never re-fetched) and links to `/content/drafts/:id`. For an
  agent-originated action, links to `/agents/:id` when the bounded join
  resolves it, `/agents` otherwise — never a dead end. For a
  recommendation-only action (no draft yet), links to `/recommendations`.
- **`src/components/actions/action-card.tsx`** (new) — one row, reused
  across all four sections (same "one component, many places" precedent
  `pending-action-panel.tsx` sets); which control renders (Approve /
  Execute — publish now / Roll back / none) is driven entirely by
  `action.status`. Level 4 never gets an Approve/Execute control here
  regardless of status — UI-layer defense in depth mirroring the server's
  own unconditional guard clause, not a substitute for it. The
  completed/rolled-back outcome block shows the publish target, destination
  reference, timestamps, and — within the 30-day window — the Roll back
  button with its exact deadline.
- **`src/components/actions/actions-view.tsx`** (new) — the `/actions`
  screen: `PageHeader`, an owner/admin role hint (mirroring
  `billing-panel.tsx`'s convention) when the viewer can't publish, then four
  `Tabs` sections (Pending approval / In progress / Completed / Rolled
  back), each with its own designed empty state (why it's empty, what to
  do, one click away — linking to Content and/or Agents, the two real
  origination points) and loading/error states via `useAsyncData` +
  `ErrorPanel`. Approve/Execute/Rollback each call the real endpoint, toast,
  and `reload()` from the server afterward — nothing is applied
  optimistically as if it were the source of truth. Rollback confirms via
  `window.confirm`, same precedent `billing-panel.tsx`'s cancel-subscription
  flow already establishes for a destructive, consequential action in this
  codebase.
- **`src/app/(app)/actions/page.tsx`** (rewritten) — was the Epic-0
  `ComingSoon` placeholder; now renders `ActionsView`, same
  `content/page.tsx` shape.
- **`src/data/nav.ts`** (extended) — removed `epic: 13` from the `/actions`
  entry — real, wired data today, same convention Epic 12's own `/agents`
  nav entry followed.

### Closing the loop on Content (Epic 11) and Agents (Epic 12) — per this
epic's explicit UI-surface instruction to link forward/backward rather than
treat Actions as an isolated list

- **`src/components/content/draft-approval-view.tsx`** (extended) — the
  post-approval state's copy and toast previously said "publishing is a
  future epic's concern," written before this epic existed. Now that
  approving a draft here really does create a pending `actions` row
  (`routes/content-drafts.ts`'s own Epic 13 handoff), the copy says so and
  adds a "Go to Actions" link — the only change; nothing about the approval
  flow itself changed.
- **`src/components/content/content-view.tsx`** (extended) — the
  "Published" tab's empty state said "Epic 13 owns actual publishing...
  once it does." Now that it does, the copy explains where published
  content actually lives (a draft itself never becomes "published,"
  ADR-007 — a separate Action Center action does) and links to `/actions`.
- **`src/components/agents/pending-action-panel.tsx`** (extended) — the
  approved state now includes a "View in Actions →" link alongside the
  existing approval/rollback-window text, so a Level 3 approval on the
  Agents screen doesn't leave the viewer wondering where it went.

## Design decisions worth naming

1. **One component per Action Center row, status-driven, not four
   near-duplicate cards.** `action-card.tsx` renders the same shape for
   every section; only which button appears (if any) changes with
   `action.status`. A future change to how an action is presented has one
   file to edit, same reasoning Epic 12's frontend doc gives for
   `pending-action-panel.tsx`.
2. **Approve and Execute are two distinct buttons in two distinct
   sections, never merged into one "Publish" action.** This mirrors the
   spec's own literal reasoning ("a human might approve now and the system
   executes async") and the backend's own two separate guard clauses — the
   UI never offers a shortcut that would blur the two decisions into one
   click.
3. **Execute's copy never implies a real external CMS.** "Writes an
   internal record only — no external CMS is connected yet" appears both in
   the pre-execute helper text and the post-execute toast — matching
   `NullPublishTarget`'s own documented scope boundary; the UI never
   oversells what this build's publish path actually does.
4. **Level 4 is never offered a control, but IS representable and
   visible.** Unlike Epic 12's trigger-only UI (where `4` is an impossible
   type, since nothing there ever needs to render an existing Level-4 row),
   `ActionAutonomyLevel` here stays `1 | 2 | 3 | 4` on purpose — this
   epic's own non-negotiable requires the block be provable against a row
   that legitimately holds `4`, and a UI that quietly couldn't even
   represent such a row would be hiding the case it's supposed to defend
   against, not proving the defense holds. `action-card.tsx` shows an
   explicit "blocked" panel instead of an Approve/Execute button for one.
5. **Rollback outcome data is honestly session-scoped, not silently
   treated as durable.** There is no `GET /published-content/:id` route —
   the full `PublishedContent` record (title/body snapshot, raw
   `PublishTarget` result) is only ever returned inline by the
   execute/rollback POST responses themselves. This frontend keeps that
   in a local `Map` for the current session and falls back to `action.
   result`'s summary pointer (`publishedContentId`, `destinationRef`) on
   every other load — documented as a real limitation below, not silently
   passed off as always-available detail.
6. **Rollback confirms via `window.confirm`, not a new dialog pattern.**
   `billing-panel.tsx`'s cancel-subscription flow is this codebase's only
   existing precedent for confirming a consequential, human-triggered
   mutation; rollback reuses it rather than introducing a second confirm
   pattern for what both `packages/ui`'s `Dialog` and a native `confirm`
   could equally serve.
7. **The role hint for owner/admin-only actions follows `billing-panel.tsx`'s
   exact convention** (`currentUser.role` from `data/fixtures.ts`, the same
   documented pre-Epic-0-session-wiring gap every prior verified epic's
   settings screens already share) rather than inventing a new client-side
   session/role source for this epic alone. The server's own 403 remains
   the real enforcement either way.

## Known limitations (documented, not silently skipped)

1. **`agentRunIdsByPendingActionId` is a bounded, best-effort join, not a
   guaranteed resolution.** Same shape and same limit as Epic 12's own
   `listPendingActionsByRecommendationId`: only the 10 most recent Level-3
   agent runs are scanned. An agent-originated action whose pending action
   falls outside that window still displays fully (title, description,
   status, all four control states) — it just links to `/agents` (the list)
   instead of the one specific run.
2. **No `GET /published-content/:id` route exists**, so the full outcome
   record (title/body snapshot, raw `PublishTarget.result` payload) is only
   ever visible for actions executed or rolled back within the CURRENT
   browser session, held in local component state. A page reload (or a
   different session/device) falls back to the leaner `action.result`
   summary (`publishedContentId`, `destinationRef`) that `GET
   /brands/me/actions` itself always returns — real data either way, never
   fabricated, just a narrower view after a reload. This is a backend API
   surface gap, not something this frontend can work around without an
   extra route.
3. **No reject/dismiss action for a pending Action Center row.** The
   backend's own API surface has no such endpoint (`actions.status` never
   transitions to anything but `pending -> approved -> completed`, or
   `rolled_back` — there's no "rejected" value in `chk_actions_status` at
   all) — only Approve/Execute/Rollback exist in this UI because only those
   three exist to call.
4. **No automated frontend tests** — `@bebest/web` still has no test runner
   configured for any screen in this codebase (checked: no `*.test.*` files
   anywhere under `apps/web/src`, no `test` script in
   `apps/web/package.json`), consistent with every other already-shipped
   `apps/web` epic. Verified instead via `typecheck`/`lint`/`build`, all
   clean (see below).
5. **`currentUser.role` is still the pre-session-wiring fixture** every
   settings screen in this codebase already reads from (`data/
   fixtures.ts`'s own documented Epic-0 gap) — used here only as a UI hint
   for which buttons to show enabled; the real gate is the server's
   `publish_content` permission check on every one of the three mutating
   routes.

## Verification

- `pnpm --filter @bebest/web typecheck` (`tsc --noEmit`) — clean.
- `pnpm --filter @bebest/web lint` (`eslint .`) — clean.
- `pnpm --filter @bebest/web build` (`next build`) — clean; the route table
  includes the new `○ /actions` route alongside every pre-existing route,
  none of which regressed.
- `pnpm --filter @bebest/web test` — no task configured (see "Known
  limitations" #4), consistent with the rest of this app.
- Manually traced against the backend's actual route/serializer/type source
  (`routes/actions.ts`, `routes/action-details.ts`, `lib/actions/
  {serialize,publish-target,rollback-window}.ts`,
  `apps/api/src/routes/{actions,action-details}.test.ts`'s own exact
  response-shape assertions) field-for-field before writing `data/actions/
  types.ts`/`client.ts`, not guessed from
  `docs/epics/13-action-center-publishing-backend.md`'s prose alone.

## Files touched

New:
- `platform/apps/web/src/data/actions/{types,labels,rollback-window,client}.ts`
- `platform/apps/web/src/components/actions/{action-origin,action-card,actions-view}.tsx`
- `platform/docs/epics/13-action-center-publishing-frontend.md` (this file)

Rewritten:
- `platform/apps/web/src/app/(app)/actions/page.tsx` (Epic-0 `ComingSoon`
  placeholder -> renders `ActionsView`)

Extended (Epic 11/12's own files, forward/backward-link copy only — no
other behavior in any of these files changed):
- `platform/apps/web/src/components/content/draft-approval-view.tsx`
- `platform/apps/web/src/components/content/content-view.tsx`
- `platform/apps/web/src/components/agents/pending-action-panel.tsx`
- `platform/apps/web/src/data/nav.ts`
