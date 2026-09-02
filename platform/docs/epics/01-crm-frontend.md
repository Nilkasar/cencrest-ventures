# Epic 1 — CRM (frontend half)

Status: built, verified locally (typecheck + lint + production build all
pass; every screen exercised in a real browser — desktop, mobile viewport,
and dark mode — via a headless-Chromium smoke pass, screenshots inspected).
No backend exists yet for this epic — nothing here makes a network call;
everything runs against typed, realistic fixture data through the same
data-access seam a real API call will use.

Built against `docs/epics/01-crm.md`'s domain model and UI surface table.
Replaces the three `<ComingSoon>` placeholders at `crm/leads`, `crm/deals`,
`crm/accounts` with full list + detail screens, plus three new detail
routes the spec implies but the Epic 0 shell didn't yet have
(`crm/leads/[id]`, `crm/deals/[id]`, `crm/accounts/[id]`).

## What was built

### Data layer (`src/data/crm/`)

- **`types.ts`** — `Lead`, `Activity`, `Deal`, `Account`, `AccountContact`,
  camelCased 1:1 against the spec's domain model. `AccountPlan` is a type
  alias for `Organization["plan"]` (from `data/types.ts`), not a parallel
  enum — because an account *is* an organization for CRM purposes per the
  spec's model decision, and aliasing means it can never silently drift out
  of sync with the platform's actual plan list (this mattered in practice:
  a concurrent epic's agent added a `"free"` plan tier mid-session, and the
  alias picked it up automatically with zero code change here).
- **`fixtures.ts`** — 11 leads, 10 deals, 4 accounts (2 of which reuse the
  same org ids as `data/fixtures.ts`'s org switcher — Northwind Logistics
  and Cascade Fintech are the *same* tenants, just viewed from "who did we
  sell to" instead of "what am I working in"), ~28 activities. Every
  status, source, deal stage, and empty-field case (unscored lead, no
  assignee, no close date, lost deal with a reason, direct-signup account
  with no source lead) has at least one row so every screen's edge cases
  render without hunting for them. Timestamps are hardcoded absolute ISO
  strings, not `Date.now()`-derived — see "Notable decisions" below.
- **`client.ts`** — the seam every screen calls through. `fetchLeads`,
  `fetchLead`, `createLead`, `updateLeadStatus`, `convertLead`,
  `fetchDeals`, `fetchDeal`, `fetchDealsForLead`, `fetchDealsForAccount`,
  `createDeal`, `updateDealStage`, `fetchAccounts`, `fetchAccount`,
  `fetchActivitiesForLead/Account/Deal`, `logActivity`, `fetchCrmUsers`.
  Each simulates a 450ms network delay and mutates an in-memory copy of the
  fixtures (persists for the tab's session, not across a hard refresh) —
  enough that converting a lead, moving a deal, or logging an activity
  feels real when clicking through, without pretending there's a database.
  Wiring the real API later is a one-line body swap per function (the
  intended shape is written in the file's own header comment, e.g.
  `apiClient.get<Lead[]>('/crm/leads?...')`).
- Append `?bbDemoError=1` to any CRM URL to force every in-flight fetch to
  reject — the one deliberate hook for exercising the error+retry state on
  demand without a real backend to fail against.

### Shared plumbing

- **`src/lib/use-async-data.ts`** — the generic loading/error/success hook
  every list and detail view is built on. No screen has a bare
  `if (loading) return null`.
- **`src/lib/format.ts`** — `formatCurrency`, `formatCompactCurrency`,
  `formatDate`, `formatDateTime`, `formatRelativeTime`.
- **`src/components/patterns/error-panel.tsx`** — the shared inline error
  state (message + a real "Try again" that calls `reload()`), full-size for
  a list/detail view and `compact` for smaller contexts.

### Screens

- **Leads inbox** (`crm/leads` → `components/crm/leads-view.tsx`) — stat
  strip (total / needs a response / converted), search + status + source
  filters, sortable-by-recency table (avatar, name/company, source badge,
  status badge, mono score colored by band, assignee or "Unassigned",
  relative created time). Row click and Enter-key both navigate to detail.
  Two distinct empty states: true-zero (explains the apply-form
  integration lands in Epic 20, offers "Add a lead") vs. filtered-to-zero
  ("Clear filters"). "Add a lead" is reachable from both the filter bar
  (always) and the empty state (per the spec's explicit empty-state
  contract) — same dialog component in both places.
- **Lead detail** (`crm/leads/[id]`) — activity timeline, a visual pipeline
  (New → Contacted → Qualified → Converted, with Lost as a branch) that is
  read-only by design — the actual status change happens through an
  adjacent `<Select>` so every transition has a keyboard/screen-reader
  path — contact card, linked deals, and a "Convert to account" dialog that
  mirrors the real `POST /leads/:id/convert` contract (creates an org,
  links back, preserves activity history, never deletes the lead). Once
  converted, the status selector disables and a "View account" button
  replaces "Convert."
- **Deals pipeline** (`crm/deals` → `deals-board-view.tsx`) — stat strip
  (open pipeline, probability-weighted open value, won), owner + search
  filters, a 6-column kanban board (New/Qualifying/Proposal/Negotiation/
  Won/Lost) with per-column count and value. Stage changes work two ways:
  native HTML5 drag-and-drop between columns for mouse users, and a
  `DropdownMenu` "Move to ▸" on every card for a fully keyboard/
  screen-reader-reachable equivalent — drag-and-drop alone is never
  accessible, so it's a progressive enhancement, not the only path. Empty
  state offers both "Add a deal" and "Go to leads" per the spec's guidance.
- **Deal detail** (`crm/deals/[id]`) — stage changer (a `<Select>`, with a
  caption noting stage changes are audit-logged server-side per the spec),
  a required lost-reason capture when moving to Lost, linked lead/account
  card, and deal-scoped notes. Deals have no activities table of their own
  in the domain model, so deal notes are logged as ordinary `Activity`
  rows against the deal's lead/org with `metadata: { dealId }` — using the
  `metadata` field the spec already gives activities, rather than inventing
  a parallel notes concept.
- **Accounts list** (`crm/accounts` → `accounts-view.tsx`) — stat strip,
  search, table (account + domain, plan badge, primary contact, deal
  count + value, source lead or "Direct signup", created date). The empty
  state's action is "View leads to convert," not "Add an account" — the
  spec's API surface only lists/gets accounts (they're a view over
  `organizations`), there's no create-account endpoint to stub honestly.
- **Account detail** (`crm/accounts/[id]`) — `Tabs` for Overview / Contacts
  / Deals / Activity. Overview surfaces origin (converted-from-lead link,
  or "signed up directly"), primary contact, and total deal value. Each
  tab has its own empty state (e.g. an account with zero deals still shows
  a clean "No deals for this account yet" rather than a blank tab).

### Reusable CRM components

`status-badges.tsx` (lead status / deal stage / lead source badges, plus a
mono-numeral `LeadScore`), `activity-timeline.tsx`, `log-activity-dialog.tsx`,
`lead-status-pipeline.tsx`, `add-lead-dialog.tsx`, `convert-lead-dialog.tsx`,
`add-deal-dialog.tsx`, `deal-card.tsx` — all composed from `@bebest/ui`
primitives only (Table, Card, Badge, Dialog, Select, Tabs, DropdownMenu,
EmptyState, Skeleton, Avatar, Toast). No new base primitive was invented;
the one new leaf component from `@bebest/ui` this epic uses —
`Textarea` — was added to the design system by a concurrent agent working
Epic 2 in the same tree, and `log-activity-dialog.tsx` was written against
it instead of hand-rolling a styled `<textarea>`.

## Design decisions

- **Every list has a real loading skeleton, error state, and two empty
  states** (zero-data vs. filtered-to-zero) — never a bare
  `if (loading) return null`. `use-async-data.ts` centralizes this so it's
  one hook, not four copy-pasted `useState` triples.
- **Badge color mapping stays inside the existing `@bebest/ui` variant set**
  (`neutral` / `outline` / `warning` / `success` / `danger`) — there's no
  `info` variant in the design system's `Badge`, so "new" status/stage
  states use `neutral`/`outline` rather than reaching for a token that
  doesn't exist. Status is always paired with a text label, never
  color-only, per the design system's accessibility baseline.
- **Timestamps in fixtures are hardcoded absolute ISO strings**, not
  `Date.now()`-derived. Every CRM view is a client component that fetches
  through `use-async-data`, so the server-rendered HTML is always the
  loading skeleton — actual dates only ever render client-side after
  mount, which sidesteps a relative-time hydration mismatch outright
  rather than needing a `suppressHydrationWarning` workaround.
- **Drag-and-drop is a progressive enhancement, not the only stage-change
  path.** The kanban board's native HTML5 DnD is mouse-only; every card
  also has a `DropdownMenu` "Move to ▸" so the same action is reachable by
  keyboard and announced to a screen reader.
- **The lead status pipeline is a vertical stack, not a horizontal
  stepper.** An early horizontal version overflowed its sidebar card at
  four steps + "Converted" (visible in a screenshot during review — the
  text ran past the card's right edge) — since the card's width is fixed
  and narrow by layout, vertical is the fix that works at any label length
  rather than shrinking type or truncating "Converted."

## What's stubbed vs. real

**Real**: every screen's data flow (fetch → loading → success/error/empty),
all filters and search, the kanban drag-and-drop and its keyboard
equivalent, lead conversion's full effect (creates an account, activity
row, links back), deal stage transitions (including the required
lost-reason capture), activity logging against a lead/account/deal, and
every empty/loading/error/not-found state a screen can be in.

**Stubbed**: there is no backend for this epic yet. `data/crm/client.ts`'s
functions mutate an in-memory array instead of calling
`platform/apps/api` — durable only for the current browser tab, gone on a
hard refresh. RBAC (owner/admin/analyst can edit, editor can log activities
only, viewer read-only, per the spec's entitlements section) is not
enforced anywhere in this app yet — every action is available to whoever
has the page open, since there's no real session/role to check against.
Audit logging for deal stage transitions is called out in a UI caption
("Stage changes on deals are recorded in the audit log") but nothing
actually writes an audit entry — that's `platform/apps/api`'s job once it
exists.

## Deferred

- **Wiring `platform/apps/api`'s real routes** once that half of Epic 1
  lands — per function, this is a body swap in `data/crm/client.ts`, not a
  rewrite of any screen.
- **RBAC-aware UI** (hiding/disabling actions by role) — needs a real
  session to read a role from; not fakeable honestly against fixtures.
- **Pagination** on the leads/deals/accounts lists — the spec calls for
  paginated list endpoints; the fixture sets are small enough (11/10/4
  rows) that client-side rendering of "everything" doesn't misrepresent
  what a real, larger dataset will need. A real API wire-up should add
  page-size/cursor params to `fetchLeads`/`fetchDeals` at that point.
- **A `Textarea`-style rich activity log** (attachments, @mentions) —
  out of scope; the spec's activity model is `subject` + `body` text only.
- **Automated tests** — no component or integration test suite exists yet
  for these screens; verification this session was manual (typecheck,
  lint, production build, and a full click-through with screenshots in
  light mode, dark mode, and a mobile viewport, console-error-checked at
  every step).

## Verification performed

- `pnpm --filter @bebest/web typecheck` — clean.
- `pnpm --filter @bebest/web lint` — clean for every file this epic
  touched (a handful of pre-existing `react-hooks/set-state-in-effect`
  findings remain in Epic 2's onboarding files, out of scope here).
- `pnpm --filter @bebest/web build` — production build succeeds; all six
  CRM routes appear in the route manifest, the two list routes prerender
  static, the three `[id]` routes correctly render dynamic.
- Full click-through in a headless Chromium session against `next dev`:
  leads list, lead detail (qualified/converted/lost states), deals kanban
  board, deal detail, accounts list, account detail, the "Add a lead"
  dialog, a not-found detail state, and the `?bbDemoError=1` error state —
  each screenshotted, `console --errors` checked clean at every step.
  Repeated at a 390px mobile viewport (tables and the kanban board scroll
  horizontally inside their own container; the page body never does) and
  with `localStorage["bebest-theme"] = "dark"` set before load (every
  screen holds contrast and legibility with zero hardcoded light-mode
  color leaking through).
