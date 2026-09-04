# Epic 1 — CRM frontend rewire (fixture → real API)

Status: wired against the real, VERIFIED backend routes built in Wave 1
(`apps/api/src/routes/{leads,deals,accounts,activities}.ts`). Typecheck,
lint, and production build all pass. No test runner exists for `@bebest/web`
(consistent with every other epic's frontend), so this was verified by
tracing every call site against the real route handlers, not by running the
app against a live database (out of scope — no DB connection available in
this pass).

Follows `01-crm-frontend.md` (the original fixture-only build) and closes
the gap the Epic 21 final audit flagged: the frontend never actually called
`apps/api`, even though a real, tested backend for this epic had existed
since Wave 1.

## What changed

Only `src/data/crm/client.ts` (full rewrite), `src/data/crm/types.ts` (one
field widened), and four small, backend-driven touches to two CRM view
components. No other epic's code was touched. No screen component's data
shape or call signature changed — every `fetchX`/`createX`/`updateX`
function in `client.ts` keeps its original signature, so `leads-view.tsx`,
`lead-detail-view.tsx`, `deals-board-view.tsx`, `deal-detail-view.tsx`,
`accounts-view.tsx`, and the four dialogs needed no changes beyond the two
described below.

### `src/data/crm/client.ts`

Every function now calls `apiClient` against the real routes. **One
correction versus the old file's own header comment**: it guessed the
routes would be namespaced under `/crm` (`/crm/leads`, etc.) — the real
backend mounts them flat at `/api/leads`, `/api/deals`, `/api/activities`,
`/api/accounts` (`apps/api/src/app.ts`). Paths in the new file match the
real mount points, not the old guess.

Real routes wired:

| Function | Route |
|---|---|
| `fetchLeads`/`fetchLead`/`createLead` | `GET/POST /api/leads[/:id]` |
| `updateLeadStatus` | `PATCH /api/leads/:id` |
| `convertLead` | `POST /api/leads/:id/convert` |
| `fetchDeals`/`fetchDeal`/`createDeal` | `GET/POST /api/deals[/:id]` |
| `updateDealStage` | `POST /api/deals/:id/stage` (the only path that can change `stage` — plain `PATCH` rejects the field, per the backend's own "always audited" design) |
| `fetchAccounts`/`fetchAccount` | `GET /api/accounts[/:orgId]` |
| `fetchActivitiesForLead/Account/Deal`, `logActivity` | `GET/POST /api/activities` |
| `fetchCrmUsers` | `GET /api/orgs` + `GET /api/orgs/:slug/members` (see below — no dedicated CRM users endpoint exists) |

Auth/error handling follows `lib/api-client.ts` exactly — no parallel fetch
mechanism. Bearer token, 401-triggers-one-shared-refresh, `ApiError` on
non-2xx — all inherited from `apiClient`, same as `data/actions/client.ts`
and `data/reporting/client.ts`.

## Fields/behaviors reconciled against the real backend

The real API's shape genuinely differs from what the old fixture-typed UI
assumed in several places. Each is reconciled in `client.ts`'s mapping
layer, not by fabricating data or (mostly) touching the UI:

1. **`assignedTo` (Lead), `owner` (Deal), `actor` (Activity)** — the real
   API returns raw user ids (`assignedTo`, `ownerId`, `actorId`), not
   embedded `{id, name}` refs. There is no dedicated "CRM users" endpoint.
   `fetchCrmUsers()` resolves real names by calling `GET /api/orgs` (orgs
   the caller belongs to) and then `GET /api/orgs/:slug/members` for the
   first one that answers — CRM access already requires the caller's org to
   be the internal ops org (see #4 below), so in practice that's the first
   and only membership for CRM staff. Results are cached for the tab's
   session. If a specific id can't be resolved (e.g. a since-removed
   teammate), the UI shows "Unknown teammate" rather than failing the whole
   screen.

2. **`Deal.probability`** — real schema allows `null` (unset); every screen
   that reads it treats it as a plain number (weighted pipeline total, the
   `{deal.probability}%` badge on `DealCard`). Normalized to `0` in
   `mapDeal()` rather than widening `Deal.probability` to `number | null`
   and touching every display site — an unset probability reading as 0% is
   accurate, not a guess.

3. **`Lead.organizationId` / `Activity.organizationId`** — renamed from the
   real API's `convertedOrganizationId` / `accountOrganizationId` in the
   mapping layer only; the type names (chosen in the original fixture pass)
   are kept so no component needed to change.

4. **Org-switcher tenant scoping — genuinely different from the old
   fixtures, not just cosmetically.** The old fixtures faked "switching
   orgs shows different CRM data" by reusing org ids across `data/crm/
   fixtures.ts` and `data/fixtures.ts`. The real backend does **not** work
   that way: `apps/api/src/middleware/crm-access.ts` gates every CRM route
   on the caller's *currently selected* org (the access token's `org`
   claim) being one single, fixed internal BeBest operations org
   (`CRM_INTERNAL_ORG_ID`) — CRM is an internal ops tool in v1, never
   scoped to a customer's own org (this is the real backend's own explicit
   design, not an oversight). Checked how the only other org-switching flow
   in this codebase — `components/shell/org-switcher.tsx`'s Epic 18 "act as
   a client org" selector — behaves: switching to a client org mints a
   token scoped to that client org, which would make every CRM call 403.
   That component is out of this epic's scope to change (it's Epic 18's,
   and the app has no general "current org slug" session concept yet — see
   its own doc comment), so instead `client.ts` adds a `crmRequest()`
   wrapper that translates the specific 403 (`"CRM access requires
   selecting the internal operations organization"`), 409 (`"No
   organization selected"`), and 500 (`"CRM is not configured on this
   server"`) bodies into messages `ErrorPanel` shows as-is — a real,
   actionable error instead of a generic "Request failed with 403" if a
   staff member opens `/crm/*` while acting as a client org. Fixing the
   underlying cross-epic friction (e.g. hiding the CRM nav item while
   acting as a client org) is a follow-up for whoever owns the shell nav,
   not this rewire.

5. **`Account.plan`** — genuinely unavailable. `organizations` has no
   `plan` column in the real schema (plan lives on the separate
   `subscriptions` table, 1:1), and the only route that reads it
   (`GET /orgs/me/subscription`) is scoped to the caller's *own* org via the
   token — there is no route letting internal CRM staff read an arbitrary
   customer org's plan by id. `AccountPlan` in `types.ts` was widened to
   `Organization["plan"] | null`; `client.ts` always returns `null` here
   (never a guess). This is the one place the reconciliation genuinely
   required a UI touch: `PLAN_LABEL` is a `Record` keyed by the plan union,
   so `accounts-view.tsx` and `account-detail-view.tsx` each got a 3-line
   conditional (render the plan badge if known, an em-dash / nothing if
   not) instead of every account silently showing a wrong or fabricated
   plan.

6. **`Account.contacts`** — the real Prisma schema actually has
   `crm_contacts` and `crm_notes` models, but **no route in `apps/api`
   exposes them** (confirmed by grepping the whole `routes/` directory —
   they're referenced nowhere). Per the hard constraint on this task,
   `apps/api` wasn't touched to add one. Instead of an empty array or
   fabricated contacts, `fetchAccount`/`fetchAccounts` derive the one real
   contact available — the converting lead's actual name + email, from
   `GET /accounts/:orgId`'s embedded `lead` field (detail) or a second
   `GET /leads` call joined by `leadId` (list). The Contacts tab will show
   at most one contact instead of the fixture data's two — an honest
   reflection of what the backend actually has, not a regression introduced
   by this rewire. **Gap left for a future epic**: wire real routes for
   `crm_contacts`/`crm_notes` if multi-contact accounts are needed.

7. **`Account.domain`** — no `domain` column exists on `organizations` at
   all (confirmed via `packages/database/prisma/schema.prisma`) — not a
   permission gap like `plan`, a genuinely absent field. Always `null`;
   `Account.domain` was already nullable in `types.ts` so no type or UI
   change was needed — the domain link in both account views already only
   renders when truthy.

8. **`Account` list/detail only ever includes converted-from-a-lead
   accounts** — matches the real `accounts.ts` route's own explicit design
   ("an org only shows up here once a CRM lead has converted into it...
   deliberate, not a gap"), unlike the old fixtures which included one
   direct-signup account (Harbor & Vane) with no source lead. Real backend
   behavior, not something this rewire can or should paper over.

9. **No server-side free-text search** on `GET /leads` or `GET /deals` (no
   `q` param in either route's zod query schema) — `fetchLeads`/`fetchDeals`
   still support the `q` filter the UI already has, filtering client-side
   over the fetched page instead.

10. **No `leadId`/`accountOrganizationId` filter on `GET /deals`** —
    `fetchDealsForLead`/`fetchDealsForAccount` fetch the full (capped) deals
    list and filter client-side by the real `leadId`/`accountOrganizationId`
    fields, same as the old fixtures did, just against real data now.

11. **Pagination cap, not full pagination.** Every list route caps `limit`
    at 100 server-side; these functions all request `limit=100` (the max)
    to approximate the old fixtures' "return everything" behavior, since
    every screen's existing signature returns a plain array with no
    pagination UI. **Honest gap**: an org with more than 100 leads or deals
    matching a filter won't show the rest. No pagination UI exists yet to
    fix this properly — flagged as a follow-up, not silently truncated
    without a trace (documented here and in the file's own comments).

12. **Website URL normalization on `createLead`.** The real
    `createLeadSchema.website` requires an absolute `.url()`
    (`urlField()`); `add-lead-dialog.tsx`'s input collects a bare domain
    (e.g. `northwindlogistics.com`). `client.ts` prepends `https://` when
    the value has no scheme, so the existing UI's input still works against
    the real validation instead of every submission 422ing.

13. **`lostReason` required when marking a deal Lost.** The real
    `stageTransitionSchema` rejects `stage: "lost"` without a non-empty
    `lostReason`. The old fixtures accepted an empty reason silently. Two
    small, backend-driven UI touches (the only non-`client.ts` behavioral
    changes in this rewire): the "why was this lost?" prompts in
    `deals-board-view.tsx` and `deal-detail-view.tsx` now mark the reason
    input `required` and disable the "Mark lost" button until it's
    non-empty, so the real validation error is prevented rather than hit.

14. **`LogActivityInput.actor` is now unused.** The real `POST /activities`
    derives the actor from the caller's auth token server-side, never from
    the request body — sending one would be ignored. The field is kept on
    the interface (and `log-activity-dialog.tsx`'s app-wide, still-fixture-
    backed `currentUser` source for it left untouched, since that fixture
    is `data/fixtures.ts` — a different epic's gap) purely so that dialog
    didn't need to change; the `Activity.actor` a caller gets back is
    resolved from the real `actorId` the server recorded, via
    `fetchCrmUsers()`, not from this input.

## `fixtures.ts`

Deleted. Confirmed via repo-wide grep that `data/crm/fixtures.ts` was
imported nowhere except the old `client.ts` — no Storybook stories, no
tests reference it (there is no test runner for `@bebest/web` at all yet).

## `?bbDemoError=1`

Dropped, not replaced with an equivalent. The real API now produces real
errors on its own — a 403 from picking the wrong org (see #4 above), a 404
on a missing/renamed lead, a 422 on the lost-reason/URL validation described
above, a 500 if `CRM_INTERNAL_ORG_ID` isn't configured — and `crmRequest()`
already translates the CRM-specific ones into real, actionable
`ErrorPanel` messages. A fake failpoint would now be testing a code path
(`shouldSimulateError`) that no longer exists anywhere else in the file,
not exercising anything real. If a design review later wants a "force an
error" QA hook against the live API, that belongs as a proper feature flag
or a backend fault-injection route, not a `window.location.search` check —
not built here since it wasn't asked for.

## Verification

- `pnpm --filter @bebest/web typecheck` — pass.
- `pnpm --filter @bebest/web lint` — pass.
- `pnpm --filter @bebest/web build` — pass; all six CRM routes
  (`/crm/leads`, `/crm/leads/[id]`, `/crm/deals`, `/crm/deals/[id]`,
  `/crm/accounts`, `/crm/accounts/[id]`) build cleanly, three as static and
  three as dynamic (the `[id]` detail routes), consistent with the rest of
  the app.
- No live database in this environment, so end-to-end network behavior
  (does a real `GET /api/leads` actually return the mapped shape against a
  running Postgres) was verified by reading the backend's serializer
  functions line-by-line against this file's `Raw*` interfaces and mapping
  functions, not by hitting a live server. Recommend a `qa-tester` pass
  against a real deployed environment before this is called fully done.

## Honest gaps left

- No pagination UI — lists cap at the backend's max page size (100).
- Search on leads/deals is client-side over the fetched page, not
  server-side (no `q` param on either real route).
- `Account.contacts` shows at most one (real) contact; the schema's
  `crm_contacts`/`crm_notes` tables have no route yet.
- `Account.plan` is always `null` — no route lets internal CRM staff read
  another org's plan by id.
- Opening `/crm/*` while "acting as" a client org (Epic 18's org switcher)
  now surfaces a clear 403 message instead of silently working — the
  underlying UX (e.g. hiding CRM nav while acting as a client) is not fixed
  here, since the org-switcher/shell nav belongs to a different epic.
