# Epic 2 — Brand Intelligence (frontend half)

Status: built, verified locally (typecheck + lint + production build all
pass for `@bebest/web` and `@bebest/ui`; every onboarding route and the
Settings page smoke-tested at 200 via `next start`). No backend exists yet
for this epic — everything here reads/writes through a localStorage-backed
mock persistence layer that mirrors the shape real `apiClient` calls will
take, per the brief ("no live backend, use typed fixtures... wired through
`src/lib/api-client.ts`'s pattern").

Scope: the Epic 2 onboarding wizard (`docs/epics/02-brand-intelligence.md`
§"UI surface") as a new `(onboarding)` route group, plus wiring the
Settings > Brand profile tab (placeholder since Epic 0) to show and edit
the same saved profile afterward.

## What was built

### Onboarding wizard — `src/app/(onboarding)/**`

A new route group parallel to `(auth)`/`(app)`, with no `<AppShell>` chrome
(same instinct as `(auth)`: a focused, full-attention flow), routed as:

```
/onboarding                    Welcome — resumes to the right step
/onboarding/brand-basics       Step 1 of 5
/onboarding/competitors        Step 2 of 5 — entitlement-checked
/onboarding/industry           Step 3 of 5
/onboarding/use-cases          Step 4 of 5 — requires 3–5
/onboarding/claims             Step 5 of 5 — optional
/onboarding/done               Finalizes, or redirects back if steps remain
```

Each step is its own route (not wizard-local client state) specifically so
"leave and resume" is real: `src/lib/onboarding-client.ts` persists after
every "Continue," and the Welcome screen and Settings' Brand profile tab
both compute a resume point from `completedSteps` and route straight there.

- **`src/components/onboarding/`** — the wizard's own component set:
  `steps.ts` (step order/routing, single source of truth), `stepper.tsx`
  (numbered circles + connecting progress line on `sm:` and up, a compact
  "Step X of 5" progress bar below it), `step-actions.tsx` (Back/Continue
  footer), `onboarding-context.tsx` (loads the profile once per wizard
  session, shared via context so navigating between step routes doesn't
  re-fetch), `tag-input.tsx` and `pill-multiselect.tsx` (two small
  primitives `@bebest/ui` doesn't have yet — see "Design system" below),
  and one `Dialog`-based add/edit form per list resource (`competitor-`,
  `use-case-`, `claim-dialog.tsx`), reusing the exact `Dialog` + `Input` +
  form pattern already established on `/competitors` in Epic 0.
- **Every step has real client-side validation** distinct from the others:
  brand basics (name/website/description required, website format-checked),
  competitors (name/website required, format-checked, **and** the
  entitlement limit — see below), industry (at least one industry),
  use cases (3–5, enforced on Continue, not just a hint), claims (none —
  it's the one genuinely optional step per the spec, but the claim text
  itself is still required once you open the "add" dialog).
- **Loading state**: the wizard layout shows a skeleton mirroring a step's
  shape while the profile loads; **error state**: a real `EmptyState` with
  a "Try again" retry if the load fails (including a real failure mode —
  corrupted/hand-edited localStorage JSON — not a simulated one); dialogs
  and step submits show `Button`'s `loading` state and disable while
  in flight.

### Settings > Brand profile — `src/components/settings/brand-profile-panel.tsx`

Wired into the tab that was a `<ComingSoon epic={2}>` placeholder since
Epic 0 (`src/app/(app)/settings/page.tsx`). It reads the same
`useBrandProfile` hook the wizard uses and renders one of four states:

1. **Not started** — `EmptyState` with a "Start setup" CTA to `/onboarding`.
2. **Loading** — skeleton cards.
3. **In progress** — an accent banner ("Setup is in progress — 2 of 5
   steps done") with a "Finish setup" CTA to the resume step, *and* the
   sections that already have data rendered below it (not hidden until
   100% done — partial progress should still be visible/useful).
4. **Completed** — all five sections rendered (brand basics, competitors
   table, industry/category/market badges, use cases, brand claims), each
   with an "Edit" button that routes back into that step of the wizard —
   the wizard doubles as the edit UI rather than a separate form, since
   every step already loads current values and saves in place.

Settings also now supports `?tab=` (defaulting to `brand`, previously
hardcoded to `team`) so `/onboarding/done`'s "View brand profile" link and
any other deep link can land on a specific tab; `Tabs` is now controlled
via `useSearchParams`/`router.replace` instead of `defaultValue`.

### Data layer

- **`src/data/types.ts`** — added `Brand`, `Competitor`, `UseCase`,
  `BrandClaim`, `BrandProfile`, and the `OnboardingStepKey`/`OnboardingStatus`
  types, following the spec's domain-model field names (see "Schema
  reconciliation" below for where these diverge from the ported Prisma
  schema). Also widened `Organization["plan"]` to include `"free"` — the
  spec's entitlement table starts at a free tier that didn't exist in the
  Epic 0 fixture type; the two call sites this affected
  (`components/crm/accounts-view.tsx`, `account-detail-view.tsx`'s
  `PLAN_LABEL` records) were updated to stay exhaustive.
- **`src/data/brand-constants.ts`** — plan → competitor-limit table (free
  2 / starter 5 / growth 10 / pro 20 / agency & enterprise unlimited, per
  the spec), industry/company-size/priority/confidence option lists, and
  the badge-variant/label lookup maps shared between the wizard steps and
  the Settings panel (kept in one place so the two never drift).
- **`src/data/fixtures.ts`** — added `buildBrandProfileSeed(organizationId)`,
  the one-time seed written the first time a given org's profile is read
  with nothing saved yet. Deliberately seeded `in_progress` (brand basics
  + 3 competitors done, industry/use cases/claims not) rather than empty
  or complete, so opening the app fresh demonstrates the wizard's actual
  resume behavior and Settings' "in progress" state without any manual
  setup — a fully-empty or fully-complete seed would have hidden one of
  the two required behaviors (per the brief: "resume," and "visible/editable
  post-onboarding").
- **`src/lib/onboarding-client.ts`** — the mock persistence layer, one
  function per future API call (`saveBrandBasics`, `addCompetitor`,
  `markStepComplete`, `completeOnboarding`, etc.), each `async`, each
  simulating real latency, each persisting to
  `localStorage["bebest.brand-profile.v1.<orgId>"]`. This is the seam:
  swapping to real `apiClient.patch("/brands/me", ...)` calls later is a
  rewrite of this file's internals only, not of any call site. Exports a
  typed `EntitlementError` (limit + plan attached) and `ValidationError`.
- **`src/hooks/use-brand-profile.ts`** — the shared load/error/reload hook
  consumed by both the wizard's `OnboardingProvider` and the Settings panel.

## Entitlement enforcement (the epic's stated goal — "get this pattern right")

`addCompetitor(organizationId, plan, input)` checks `competitors.length`
against `PLAN_COMPETITOR_LIMITS[plan]` **before** writing, and throws
`EntitlementError` with the plan, the limit, and
`describeUpgradePath(plan)` — e.g. *"You've reached your Growth plan's
limit of 10 tracked competitors. Upgrade to Pro to track up to 20
competitors."* — surfaced inline in the add-competitor dialog (not a
toast; the user needs to read it before deciding what to do), never a bare
403. The live counter ("3 of 10 tracked · 7 remaining") and the "Add a
competitor" button's `disabled` state are both driven by the same
`competitorLimitFor(plan)` call, so the limit is enforced in exactly one
place. The fixture org is on the `growth` plan (limit 10); to see the
free-tier rejection path, change `currentOrganization.plan` to `"free"` in
`src/data/fixtures.ts` and try adding a 3rd competitor.

## Schema reconciliation (backend-architect: read this before Epic 2's backend)

The spec's domain model and the schema actually ported in Epic 0
(`packages/database/prisma/schema.prisma`) have diverged:

- **No `use_cases` or `brand_claims` tables exist yet.** The closest
  existing tables (`audiences`, `products`, `brand_services`) don't match
  either shape (no `confidence`/`verified`/`evidence` columns anywhere,
  and `audiences` is closer to a use case than the others but isn't named
  or shaped like one). This frontend was built against the spec's
  described shape (`docs/epics/02-brand-intelligence.md` §"Domain model"),
  per the brief — the backend will need new tables, not a repurposing of
  `audiences`.
- **`competitors` has no `priority` column** in the ported schema (only
  `competition_type: direct | indirect | aspirational`, a different
  concept). The spec's numbering (1 = primary, 2 = secondary, 3 = watch)
  is what the wizard collects and displays; reconciling this — whether
  `competition_type` becomes `priority`, or a new column is added — is a
  backend decision this frontend doesn't presume.
- **`brands.industry` is a single `VARCHAR`**, not the spec's
  `industries[]`. The wizard collects up to 3 industries as an array (the
  cap is this frontend's own choice — the spec doesn't state one — chosen
  because AI-comparison scoping stops being meaningful past a handful of
  verticals). `categories[]`/`markets[]` don't exist as brand columns at
  all yet (there's a separate `categories`/`brand_categories` join-table
  pair, but no `markets`).
- **Organization plans**: `Organization["plan"]` didn't include `"free"`
  before this epic (see "Data layer" above) — needed since the spec's
  entitlement table starts there.

None of this blocks the frontend (it runs entirely on typed fixtures), but
whoever picks up Epic 2's backend half should treat `src/data/types.ts` in
this app as the contract to reconcile toward, not assume the current
schema already matches.

## Deliberate scope decision: `entities` has no onboarding step

The spec's domain model section lists `entities` (schema.org-typed
products/services/concepts) alongside the other four tables, but the
"UI surface" section's actual wizard steps
(Welcome → Brand basics → Competitors → Industry/category → Use cases →
Brand claims → Done) never mention one. Read literally, the epic's own
rationale for `entities` — "this is what GEO's entity association gap
(Epic 8) will later check against" — points at something the GEO engine
populates/associates later, not manual onboarding data entry. Built to the
UI surface as specified; `entities` has no wizard step and no Settings
section in this frontend. Flagging this explicitly rather than silently
dropping a table from scope.

## Design system additions

`@bebest/ui` had no multi-line text input and no checkbox/toggle-group
primitive — both needed by this epic's forms (brand description, use-case
solution, brand claim text; company-size selection). Rather than one-off
style it in `apps/web`, per "reuse these primitives, do not invent
parallel ones":

- **`Textarea`** (`packages/ui/src/components/textarea.tsx`) — added to
  the design system proper, same label/description/error contract as
  `Input`, exported from the package index. This is a real system
  addition other epics can use, not an app-local component.
- **Toggle pills** (`apps/web/src/components/onboarding/pill-multiselect.tsx`)
  and the **tag/chip input** (`.../tag-input.tsx`) were kept app-local —
  narrower, wizard-specific composites built from existing primitives
  (`Badge`, `Label`) rather than new system primitives, since nothing else
  in the app needs a generalized checkbox-group or chip-input component
  yet. If a third consumer shows up, promote them to `@bebest/ui` then.

No gradients, no glass, no chat-bubble affordances anywhere in the wizard —
the entitlement error, validation errors, and empty states all follow
`packages/ui/DESIGN.md`'s existing language (muted status colors, inline
`role="alert"` text, real `EmptyState`/`Skeleton` usage, no toast for
anything the user needs to read before acting).

## Accessibility specifics

Every new interactive element keeps the baseline from `DESIGN.md`: the
stepper's step links carry `aria-current="step"` and a visible focus ring;
`TagInput` and `PillMultiSelect` are fully keyboard-operable (Enter/comma
commits a tag, Backspace-on-empty removes the last one, pills are real
`<button aria-pressed>` elements, not styled `<div>`s); every inline
validation and entitlement error renders with `role="alert"`; the "Finish
setup" flow on `/onboarding/done` announces its state via
`role="status"` while working.

## What's stubbed vs. real

**Real**: all client-side validation on every step; the entitlement check
and its specific, actionable message; persistence and resume (verified by
reloading mid-wizard — progress survives); the Settings panel reading the
exact same store the wizard writes; every loading/error/empty state is a
genuine code path (not a `setTimeout` that always succeeds) — corrupted
storage, the entitlement limit, and the "steps left" guard on `/onboarding/done`
are all real, triggerable failure modes, not simulated ones.

**Stubbed (explicitly)**: there is no backend — `onboarding-client.ts`'s
header comment says so, and every function name/signature is written to
be a near-drop-in for a real `apiClient` call once Epic 2's API routes
exist. RBAC (owner/admin/analyst write, editor/viewer read-only per the
spec) is not enforced client-side since there's no real session/role to
check yet — this frontend's `currentUser`/`currentOrganization` are
Epic 0's fixtures, not real auth state.

## Verification performed

- `pnpm --filter @bebest/ui typecheck` — clean.
- `pnpm --filter @bebest/ui lint` — clean.
- `pnpm --filter @bebest/web typecheck` — clean.
- `pnpm --filter @bebest/web lint` — clean.
- `pnpm --filter @bebest/web build` — succeeds; all 7 onboarding routes
  plus `/settings` prerender as static content.
- `next start` + `curl` smoke test — every onboarding route and
  `/settings`/`/settings?tab=brand` return 200.

Not done (no browser tooling available in this session): a visual/screenshot
pass in an actual browser, and no dark-mode spot check — same gap Epic 0's
frontend doc flagged for the same reason. Worth doing before this ships,
especially for the stepper's connecting-line fill and the entitlement
error's `danger`-on-`danger-muted` contrast in dark mode.

## Deferred to later epics (unchanged from the spec)

- Real backend persistence, RLS-scoped queries, and the actual entitlement
  check enforced server-side (Epic 2 backend half).
- `entities` — see "Deliberate scope decision" above.
- The AI Visibility Baseline itself — `/onboarding/done`'s copy is
  explicit that this starts once Epic 7 (AI Visibility Engine) exists.
- Billing/plan management — the entitlement error's "upgrade" language
  points at a real plan tier name but no upgrade flow exists yet
  (Epic 16); clicking through only reaches the still-`ComingSoon` Billing
  tab.

## Files touched

New:
- `apps/web/src/app/(onboarding)/layout.tsx`
- `apps/web/src/app/(onboarding)/onboarding/{layout,page}.tsx`
- `apps/web/src/app/(onboarding)/onboarding/{brand-basics,competitors,industry,use-cases,claims,done}/page.tsx`
- `apps/web/src/components/onboarding/{steps.ts,stepper,step-actions,onboarding-context,tag-input,pill-multiselect,competitor-dialog,use-case-dialog,claim-dialog}.tsx`
- `apps/web/src/components/settings/brand-profile-panel.tsx`
- `apps/web/src/data/brand-constants.ts`
- `apps/web/src/hooks/use-brand-profile.ts`
- `apps/web/src/lib/onboarding-client.ts`
- `packages/ui/src/components/textarea.tsx`

Edited:
- `apps/web/src/data/types.ts` (added Epic 2 domain types; widened `Organization["plan"]`)
- `apps/web/src/data/fixtures.ts` (added `buildBrandProfileSeed`)
- `apps/web/src/app/(app)/settings/page.tsx` (real `BrandProfilePanel` on the brand tab; `?tab=` controlled `Tabs`)
- `packages/ui/src/index.ts` (export `Textarea`)
- `apps/web/src/components/crm/{accounts-view,account-detail-view}.tsx` (added `free` to an existing exhaustive `PLAN_LABEL` record after widening `Organization["plan"]`)
