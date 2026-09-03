# Epic 18 — Agency / White Label / Integrations (frontend half): completion summary

Scope: `platform/apps/web` (`@bebest/web`) only. Branch `rebuild/platform`,
no other branch touched, nothing under `api/`, `web-app/`, or the
repo-root marketing site was modified, no git command was run, no database
connection was made. Backend is untouched and unread-from except as
reference (`platform/apps/api/src/routes/{agency,white-label,integrations}.ts`,
`lib/{agency-access,white-label}.ts`, and the backend's own completion doc,
`18-agency-white-label-integrations-backend.md`) — every response shape
below was checked against that code directly, not guessed from the epic
spec's prose.

**Calls the real API from `src/lib/api-client.ts` from the first line** —
no fixture layer, per the epic's standing rule. Every new screen's data
layer (`src/data/{agency,white-label,integrations}/client.ts`) hits
`platform/apps/api`'s actual routes.

## What was built

### 1. Client switcher — `src/components/shell/org-switcher.tsx` extended in place

Per the task's explicit instruction, the **existing** Epic 0 component was
extended, not replaced with a parallel switcher. Its old behavior (switch
the displayed label among two hardcoded `data/fixtures.ts` organizations,
no fetch, no route change) is gone; what's there now:

- **"Your organization"** — still the fixture-backed `currentOrganization`
  (home org). This app has no wired session/auth layer anywhere yet (see
  "Known gap" below) — there is no real "which orgs am I a direct member
  of" endpoint this frontend can call today, so the home-org anchor stays
  exactly as every other epic's real-API wiring already treats "who am I"
  (e.g. `BillingPanel`/`IntegrationsPanel`/`WhiteLabelPanel` all read
  `currentUser.role` from the same fixture for the same reason).
- **"Client organizations"** — fetched live from `GET /api/agency/clients`
  (`data/agency/client.ts`'s `listAgencyClients`), filtered to `status:
  "active"` client-side (a pending/revoked/paused/terminated link isn't
  something you can act as). Loading, error, and empty states are real,
  not stubbed.
- **Selecting a client** calls the actual "acting as" endpoint,
  `POST /auth/select-org` (`switchToOrg`), the exact route
  `apps/api/src/routes/auth.ts` extended this epic to also try
  `resolveAgencyAccess` before rejecting. Success updates the switcher's
  displayed org and toasts; a `403`/`404` (no membership, no active link,
  or a link revoked a moment earlier — the DoD's own scenario) surfaces as
  a real, specific toast via `OrgAccessDeniedError`, not a generic failure.
- A "Manage client organizations" link routes to the new `/agency` page.

**Known gap, stated plainly rather than faked:** nothing in this frontend
(not this epic, not any prior one) yet attaches an access token as an
`Authorization` header on subsequent `apiClient` calls — `lib/api-client.ts`
still only sends `credentials: "include"`, exactly as Epic 0 left it. So
`switchToOrg`'s real request/response/error handling is fully wired and
exercised, but the org context it mints doesn't yet propagate into requests
made after switching. This is the same missing layer every other epic's
"real API wiring" is already standing on top of (billing, opportunities,
CRM, etc. all call real routes that themselves require
`Authorization: Bearer`, which nothing in this app sends yet either) — not
a gap this epic introduced or could close alone without touching
cross-cutting session infrastructure no epic has been scoped to build yet.
Documented here rather than silently worked around.

### 2. Agency dashboard — `/agency` (new nav item, "Agency" group)

- `src/app/(app)/agency/page.tsx` + `src/components/agency/agency-clients-view.tsx`
  — two tabs on the same `agency_clients` table, matching
  `routes/agency.ts`'s own documented "two distinct read/write paths on the
  same table" split:
  - **"My clients"** (agency side): `GET /agency/clients`, with the real
    per-client summary (AI Visibility Score, open opportunities) the
    backend computes from Epic 7/9's own tables. `InviteClientDialog`
    (`components/agency/invite-client-dialog.tsx`) wraps
    `POST /agency/clients` with typed error handling for every documented
    case (`ClientOrgNotFoundError` 404, `CannotLinkSelfError` 422,
    `LinkAlreadyExistsError` 409 — with the existing link's status shown,
    `ClientLimitReachedError` 402 — with the plan/limit/current/upgradeTo
    fields the backend returns). Revoke is available for
    `pending`/`active`/`paused` links via `POST /agency/clients/:id/revoke`,
    with a confirm dialog naming the immediate-effect property the DoD
    requires.
  - **"Agencies managing us"** (client side): `GET /agency/clients/incoming`,
    with Accept (`POST /agency/clients/:id/accept` — the explicit consent
    step) and Revoke/Decline actions.
  - Every mutating action `reload()`s its list from the server rather than
    mutating local state optimistically — deliberately, so the UI's own
    next read is what proves a revoke took effect, not a client-side guess.
- `src/data/agency/{types,client}.ts` — wire types and the data-access seam,
  same role `data/billing/client.ts` plays for Epic 16. Every documented
  error shape (`404`/`422`/`409`/`402`/`403`) gets its own typed error
  class, translated once in the client layer, never re-parsed at the UI
  layer.
- `src/data/nav.ts` — new "Agency" nav group, one item ("Clients" →
  `/agency`), `Network` icon (kept distinct from CRM's `Handshake` icon
  already in the sidebar, to avoid two different concepts reading as the
  same glyph next to each other).

### 3. White-label settings — Settings > White label tab

- `src/components/settings/white-label-panel.tsx`, wired to
  `GET/PATCH /orgs/me/settings/white-label` via
  `src/data/white-label/{types,client}.ts`.
- Every field the backend accepts is editable: brand name, logo URL,
  primary/secondary color (hex, with inline validation and a live swatch
  preview), custom domain (labeled display-only, matching the backend's own
  "no real DNS/routing" note), support email, hide-"Powered by BeBest", and
  the two custom legal URLs. `enabled` and `hidePoweredBy` are exposed as
  immediate-effect toggle buttons rather than a checkbox — `@bebest/ui` has
  no checkbox/switch primitive today (checked `packages/ui/src/index.ts`'s
  full export list before deciding this, not assumed), and adding one to
  the shared design system was out of this epic's scope; a labeled toggle
  button reads correctly in the existing button vocabulary and needed no
  new shared component.
- `402 feature_not_available` (the org's plan lacks the `white_label`
  entitlement) renders as a named upsell card with a direct link to
  Settings > Billing, not a generic error — mirrors `BillingPanel`'s own
  `BillingForbiddenError` treatment for the equivalent owner-only case.
- Non-admin viewers see the same fields read-only, matching the
  `requireOrgFromToken('admin')` gate server-side, with the same
  "mirrors the real 403, doesn't replace it" caveat `BillingPanel`'s doc
  comment already states for its own `manage_billing` check.

### 4. Integrations tab — Settings > Integrations tab

- `src/components/settings/integrations-panel.tsx`, wired to
  `GET /integrations` + `POST /integrations/:provider/{connect,disconnect}`
  via `src/data/integrations/{types,client}.ts`.
- Renders one row per `SUPPORTED_PROVIDERS` entry (today: Google Search
  Console only, matching `routes/integrations.ts`'s own `PROVIDER_SLUGS`
  allowlist and its "not done: Bing Webmaster" note — the list is not
  invented ahead of what the backend actually backs, per that route's own
  warning about a "connection record with no consumer" gap), with real
  connected/disconnected/error status, connect/disconnect actions, and
  timestamps. Copy states plainly that no real OAuth handshake happens in
  this build.
- Connecting here is the literal action that makes
  `apps/api/src/lib/seo/resolve-provider-for-org.ts` prefer
  `MockSearchConsoleProvider` over `NullSEODataProvider` on this org's next
  SEO keyword-group generation (end-to-end flow step 5) — the panel's copy
  says so, so the connection isn't presented as cosmetic.

`src/app/(app)/settings/page.tsx` gained the two new tabs
(`white-label`, `integrations`) in the existing URL-synced `Tabs`
component, same pattern `billing` already used — no new routing mechanism.

## Files touched

**New:**
- `src/data/agency/{types,client}.ts`
- `src/data/white-label/{types,client}.ts`
- `src/data/integrations/{types,client}.ts`
- `src/components/agency/{agency-clients-view,invite-client-dialog,status-badges}.tsx`
- `src/components/settings/{white-label-panel,integrations-panel}.tsx`
- `src/app/(app)/agency/page.tsx`

**Modified:**
- `src/components/shell/org-switcher.tsx` — extended in place (see above).
- `src/data/nav.ts` — new "Agency" nav group/item.
- `src/app/(app)/settings/page.tsx` — two new tabs wired to the panels above.

## Verification

- `pnpm --filter @bebest/web typecheck` — clean (`tsc --noEmit`).
- `pnpm --filter @bebest/web lint` — clean (`eslint .`; one
  `react-hooks/set-state-in-effect` case in `white-label-panel.tsx` is
  explicitly suppressed with the same justification `use-async-data.ts`
  already documents for the identical "seed local draft state from a fresh
  fetch" situation — not a blanket disable).
- `pnpm --filter @bebest/web build` — clean production build (`next build`
  via Turbopack); `/agency` appears in the route list alongside every
  existing route, and `/settings` still builds with the two new tabs.
- No test script/files exist for `@bebest/web` (confirmed before finishing,
  not assumed) — consistent with every other epic's frontend half in this
  app; nothing to run.

## What's not done

- **Session/token propagation after "acting as."** Stated above under the
  client switcher — `switchToOrg` calls the real endpoint and handles every
  documented response, but nothing yet attaches the resulting token to
  later requests. This is Epic 0's frontend session layer, not something
  addressable inside this epic without taking on cross-cutting scope no
  epic has been asked to build yet (every other epic's "real API wiring" is
  in the same position: correct routes/shapes/errors, sent without the
  `Authorization` header the backend's `requireAuth` actually requires
  outside the dev bypass).
- **Bing Webmaster Tools** is not offered in the Integrations tab, matching
  the backend's own "not done" note — there is no `MockBingWebmasterProvider`
  for a connection here to mean anything yet.
- **White-label preview.** The panel edits and saves real branding fields,
  but there is nowhere in this app yet to *preview* them applied to a
  report or the public snapshot page — matching the backend's own
  documented reason (Epic 15 doesn't exist yet; Epic 17's snapshot page has
  no per-customer org to brand). `resolveWhiteLabelBranding` remains the
  backend seam for whichever future epic renders a report.
- **No shared checkbox/switch component was added to `@bebest/ui`.** Boolean
  fields use existing toggle-button styling instead — a deliberate choice
  to avoid modifying the shared design-system package for one epic's two
  boolean fields; worth revisiting if a third boolean-heavy settings screen
  makes the pattern feel repetitive.
