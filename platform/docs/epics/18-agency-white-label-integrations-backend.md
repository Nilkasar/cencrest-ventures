# Epic 18 — Agency / White Label / Integrations (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root marketing
site was modified. **Frontend is not built** — a separate agent wires the
agency dashboard / white-label settings / integrations tab against the real
routes documented below.

**No database was connected to at any point.** `prisma validate` and
`prisma generate` were run (schema-only, `DATABASE_URL` set to a dummy value
so the CLI has something to parse — no connection attempted). No `migrate`,
`db push`, or `db pull` was run, per the hard constraint.

**No real network call to any AI provider, OAuth provider, payment
provider, or external site was made anywhere in this build.**
`MockSearchConsoleProvider` and the `POST /integrations/:provider/connect`
mock both make zero network calls — see their own "DEPLOYMENT-TIME
INTEGRATION POINT" comments for exactly where a real implementation would
plug in.

**Concurrent work.** Epic 10 (Recommendation Engine) was being built in
parallel and had already touched `packages/database/prisma/schema.prisma`,
`packages/database/src/{client.ts,index.ts}`, and `apps/api/src/app.ts`
(new `opportunity_recommendations`/`recommendation_action_type` types, new
routes/mounts) by the time this epic started editing the same files. Each
was re-read immediately before editing and this epic's additions were
merged in alongside that work without touching it — confirmed by a full
`tsc --noEmit` + `vitest run` pass across `apps/api` afterward (630 tests
passed, including every Epic 10 test file).

**Migration numbering.** `0012_recommendation_engine/` (Epic 10, concurrent)
had already claimed 0012 by the time this epic checked — `packages/
database/prisma/migrations/` was re-listed immediately before creating a
new folder, per the task's standing instruction. This epic's migration is
`0013_agency_white_label_integrations/`.

---

## The schema question this epic had to answer first

**`agency_clients`, `integrations`, and `white_label_configs` already
existed** — ported from the original `api/prisma/schema.prisma` and
generically hardened (multi-tenancy, RLS, timestamps) in the same one-time
pass every table in this schema went through, well before any epic-specific
route was written (confirmed by reading `schema.prisma` and `prisma/
migrations/0000_init/{rls.sql,checks.sql}` directly, per this epic's own
"always verify against schema.prisma directly, never assume a spec's prose
name is final" instruction). None of the three needed to be built from
scratch; each needed a different, small amount of epic-specific work:

- **`agency_clients`** — had the right shape (`agency_org_id`,
  `client_org_id`, its own two-tenant RLS special case) but modeled only a
  *business* relationship (`relationship_type`/`access_level`/
  `monthly_fee`/contract dates), not an access-control one — there was no
  "invited but not yet consented" state, meaning a bare `INSERT` could
  already assert `status='active'`. **Additive fix**: five new columns
  (`invited_by`, `consented_by`, `consented_at`, `revoked_by`,
  `revoked_at`) and `status`'s vocabulary widened to add `pending` (new
  default) and `revoked`. See `@bebest/database` DECISIONS.md §23 for the
  full reasoning, including why there is **no new `role` column** —
  `access_level` already encodes it, mapped onto the platform's real `role`
  enum by `lib/agency-access.ts`.
- **`integrations`** — already had `organization_id`, a closed
  `integration_type` enum that already includes `gsc` (Google Search
  Console), an encrypted-config JSON column, and a connection `status`
  enum. **Additive fix**: two nullable timestamps, `connected_at`/
  `disconnected_at` (the epic spec's own literal field names).
- **`white_label_configs`** — already a complete, dedicated, RLS'd table
  (logo, colors, custom domain, support email, hide-powered-by, custom
  terms/privacy URLs, enabled flag) — strictly better-shaped than the
  epic spec's own prose suggestion of a JSONB `whiteLabel` blob inside
  `organizations.settings`. **Used as-is, no schema change** — same "the
  spec's literal ROUTE survives even when the spec's literal TABLE name
  doesn't" precedent Epic 9 established for `unified_opportunities`.

No RLS changes were needed anywhere — all three tables already had their
policies from `0000_init/rls.sql`. `0013_agency_white_label_integrations/`
contains only `checks.sql` (the widened `agency_clients.status` constraint,
via `DROP CONSTRAINT IF EXISTS` + re-`ADD`, not an edit to `0000_init`'s
file — same precedent `0006_epic5_postverification_fixes` set).

---

## The authorization mechanism (the actual point of this epic)

**Nothing about RLS changed.** Every tenant-table query in this codebase
still goes through `withOrgContext(organizationId, ...)`, and every
tenant table's `tenant_isolation` policy still compares `organization_id`
to `app.current_org` exactly as Epic 0 built it. What's new is a single,
narrow authorization function that decides which `organization_id` a
request is **allowed to assert** in the first place:

**`apps/api/src/lib/agency-access.ts` — `resolveAgencyAccess(userId,
clientOrgId)`.** Given a user has no DIRECT membership in `clientOrgId`
(callers check that first), this walks every org the user IS a direct
member of and asks: does that org have an `agency_clients` row with
`status: 'active'` pointing at `clientOrgId`? The first match's
`access_level` is mapped onto the real `role` enum (`full→admin,
limited→analyst, read_only→viewer`), then capped by the user's own rank
at their agency org (defense in depth — a `viewer` at the agency never
inherits `admin` access to a client just because the agency's contract
with that client is broad). No caching anywhere: every call is a fresh DB
read.

**Composed into exactly two places, both pre-existing Epic 0 code, both
changed additively:**

1. `apps/api/src/middleware/tenant-context.ts`'s `resolveOrgContext` — the
   ONE function both `requireOrgBySlug` and `requireOrgFromToken` share.
   Direct-membership check runs first, completely unchanged; only when it
   returns null does `resolveAgencyAccess` get consulted. This means
   **every existing route in the codebase** (brands, competitors, seo,
   ai-runs, opportunities, recommendations, subscription, everything) now
   transparently supports "acting as" a linked client org, with zero
   per-route changes — the literal "composes with, not replaces" mandate.
2. `apps/api/src/routes/auth.ts`'s `POST /select-org` — extended the same
   way, so an agency user can obtain an org-scoped access token for a
   client org at all (they have no membership row to mint one against
   otherwise). The token's `org` claim is still just a hint, exactly as
   `types/context.ts`'s `AuthUser` doc comment already stated before this
   epic — `resolveOrgContext` re-verifies both membership AND agency access
   fresh on every subsequent request.

**The critical property — tested explicitly, not just asserted:**
revoking an `agency_clients` link (`status` no longer `'active'`) means
the very next call to `resolveAgencyAccess`/`resolveOrgContext` returns
null, because both re-read the row from scratch every time. Proven in:
- `apps/api/src/middleware/tenant-context.test.ts` — `"CRITICAL: revoking
  the agency_clients link immediately blocks the very next request"`:
  request 1 (link active) succeeds, the SAME mock is then reconfigured to
  return no active link, request 2 (same user, same token org claim, no
  restart) is rejected.
- `apps/api/src/routes/auth.test.ts` — the mirrored case for `/select-org`.
- `apps/api/src/lib/agency-access.test.ts` — unit-level coverage of the
  resolver itself (access-level mapping, role-capping, multi-membership
  walk, self-link guard).
- The third-org and "client org's own direct member is unaffected" flow
  steps are also explicit tests in `tenant-context.test.ts`.
- `platform/apps/api/src/routes/tenant-isolation.integration.test.ts` gained
  a `describe.skip('Epic 18 tenant isolation...')` block (NEEDS LIVE DB,
  matching every other epic's entry in that file) with the same revoke
  scenario written against REAL RLS + a real row, for whoever runs this
  against a live Postgres instance.

---

## API surface

All routes require `Authorization: Bearer <token>` (`requireAuth`) unless
noted. Error responses follow the codebase's existing shapes
(`{ error, message?, issues? }` for 400/422, `{ error }` for 403/404).

### Agency / client relationships — `apps/api/src/routes/agency.ts`

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/agency/clients` | `requireOrgFromToken('viewer')` + `requirePermission('manage_agency_clients')` (effectively owner/admin) | Agency side. Invites a client org by slug. **Never creates an active link** — always `status: 'pending'`. |
| `GET /api/agency/clients` | `requireOrgFromToken('viewer')` | Agency side. Lists all links (any status) with a real per-client summary for `active` ones. |
| `GET /api/agency/clients/incoming` | `requireOrgFromToken('admin')` | **Client side.** "Which agencies are inviting/managing us" — the narrow read path `agency_clients`' RLS policy doesn't cover (see below). |
| `POST /api/agency/clients/:id/accept` | `requireOrgFromToken('admin')` | **Client side.** The explicit consent step. 404 if the link isn't addressed to the caller's org (never confirms existence to a non-target org). 409 if not `pending`. |
| `POST /api/agency/clients/:id/revoke` | `requireOrgFromToken('admin')` | Either side. Idempotent (revoking an already-revoked/terminated link just reports its status, no-op). 404 for a third, unrelated org. |

**`POST /api/agency/clients` request body:**
```json
{ "clientOrgSlug": "acme-co", "role": "analyst" }
```
`role` is one of `admin | analyst | viewer` (default `viewer`) — mapped
onto `agency_clients.access_level` (`full | limited | read_only`).

**`POST /api/agency/clients` response (201):**
```json
{
  "id": "uuid",
  "agencyOrgId": "uuid",
  "clientOrgId": "uuid",
  "clientOrgName": "Acme Co",
  "clientOrgSlug": "acme-co",
  "role": "analyst",
  "status": "pending",
  "invitedAt": "2026-...",
  "consentedAt": null,
  "revokedAt": null
}
```
Errors: `404` (client org not found), `422 { error: "cannot_link_self" }`,
`409 { error: "link_already_exists", status }`, `402` (see entitlement
section below), `403` (below `manage_agency_clients`).

**`GET /api/agency/clients` response (200)** — array of the same shape
plus `summary`:
```json
[{
  "...": "as above",
  "status": "active",
  "summary": {
    "hasBrand": true,
    "aiVisibilityScore": 72.5,
    "aiVisibilityScoreAsOf": "2026-...",
    "openOpportunities": 4
  }
}]
```
`summary` is `null` for a non-`active` link (no cross-org read is even
attempted — see the RLS note below) or `{ hasBrand: false, ... : null }`
if the client has no brand profile yet. `aiVisibilityScore` reads the
client's most recent completed `ai_runs.ai_visibility_score` (Epic 7);
`openOpportunities` counts the client's non-dismissed
`unified_opportunities` rows (Epic 9). **No new rollup table** — both are
direct reads of existing tables, matching the spec's explicit instruction.

**`GET /api/agency/clients/incoming` response (200):**
```json
[{ "id": "uuid", "agencyOrgId": "uuid", "agencyOrgName": "...", "agencyOrgSlug": "...", "role": "admin", "status": "pending", "invitedAt": "2026-..." }]
```

**`POST /api/agency/clients/:id/accept` response (200):**
`{ "id": "uuid", "status": "active", "consentedAt": "2026-..." }`

**`POST /api/agency/clients/:id/revoke` response (200):**
`{ "id": "uuid", "status": "revoked", "revokedAt": "2026-..." }`

**Two read/write paths on the same table, by design.** The agency side
(`GET /clients`, `POST /clients`, agency-initiated revoke) goes through
`withOrgContext(agencyOrgId, ...)` — RLS-backed, standard. The client side
(`GET /clients/incoming`, `/accept`, client-initiated revoke) uses plain
`db` filtered explicitly by `client_org_id` in application code — because
`agency_clients`' RLS policy (written before this epic, see
`@bebest/database` DECISIONS.md §1) scopes visibility to the agency side
ONLY. This is not a gap being worked around; it's the exact same
documented precedent `invitations` already established (redeemed by an
unguessable identifier before the caller can prove membership through RLS)
applied to a second table, and it means **RLS itself was never touched or
weakened** — the client-side application check is an *additional*, narrower
guard layered on top, never a relaxation.

### White-label settings — `apps/api/src/routes/white-label.ts`
Mounted at `/api/orgs/me/settings/white-label`.

| Method | Auth | Notes |
|---|---|---|
| `GET /` | `requireOrgFromToken('viewer')` | Always 200. Returns the org's config, or the documented BeBest default if none exists. |
| `PATCH /` | `requireOrgFromToken('admin')` | Gated by the real `plans.limits.white_label` boolean (Epic 16) — `402` if the org's plan doesn't include it. Upserts. Audit-logged as `settings.changed`. |

**Response / `whiteLabel` shape** (both GET and PATCH return this):
```json
{
  "enabled": true,
  "brandName": "Acme Agency",
  "logoUrl": "https://...",
  "primaryColor": "#112233",
  "secondaryColor": null,
  "customDomain": "reports.acme.example.com",
  "supportEmail": "support@acme.example.com",
  "hidePoweredBy": true,
  "customTermsUrl": null,
  "customPrivacyUrl": null
}
```
Default (no config, disabled, or feature not entitled):
`{ "enabled": false, "brandName": "BeBest", "logoUrl": null, ..., "hidePoweredBy": false }`
(`customDomain` is display-only, per the spec — no real DNS/routing).

**PATCH body** — any subset of the same fields (all optional);
`primaryColor`/`secondaryColor` validated as `#rrggbb`;
`logoUrl`/`customTermsUrl`/`customPrivacyUrl` validated as URLs;
`supportEmail` validated as an email. `402 { error: "feature_not_available", feature: "white_label", plan }` when the plan lacks the entitlement.

### Integrations — `apps/api/src/routes/integrations.ts`
Mounted at `/api/integrations`.

| Method & path | Auth | Notes |
|---|---|---|
| `GET /` | `requireOrgFromToken('viewer')` | Lists the org's connections. Never returns `config_enc`. |
| `POST /:provider/connect` | `requireOrgFromToken('admin')` + `requirePermission('manage_integrations')` | Mock — no OAuth redirect, no network call. `:provider` allowlist: `google_search_console` only (see "not done"). |
| `POST /:provider/disconnect` | same as connect | Clears `config_enc`, sets `status: 'disconnected'`. |

**Response shape (all three):**
```json
{ "id": "uuid", "provider": "google_search_console", "status": "connected", "connectedAt": "2026-...", "disconnectedAt": null, "lastSyncedAt": null }
```
`400 { error: "unsupported_provider" }` for any `:provider` outside the
allowlist. Connecting stores a clearly-tagged mock string
(`mock:<provider>:access:<uuid>` / `...:refresh:...`) inside
`integrations.config_enc` — never a real token, never logged, never
returned in any response.

---

## Entitlements

`client_accounts` (agency tier: 20, per `plan-catalog.ts` — already seeded
by Epic 16, unchanged by this epic) is enforced via the exact same
`checkUsageLimit` pattern every prior epic uses, in `POST
/agency/clients`, counting links with `status IN ('pending', 'active',
'paused')` (a pending invite already reserves a slot — an agency can't
dodge the cap by leaving invites permanently unaccepted; `revoked`/
`terminated` rows free the slot back up). Exceeding it returns the same
typed shape every other capped resource does:
```json
{ "error": "client_limit_reached", "message": "...", "metric": "client_accounts", "limit": 20, "current": 20, "plan": "agency", "upgradeTo": "managed" }
```
with HTTP `402`.

`white_label` (boolean feature flag, also already seeded by Epic 16) gates
`PATCH /orgs/me/settings/white-label` directly via `resolvePlanLimits`
(not `checkUsageLimit`, which is numeric-only — see `plan-catalog.ts`'s own
`NumericPlanLimitKey` exclusion).

---

## Search Console integration — `SEODataProvider` wiring

`apps/api/src/lib/seo/mock-search-console-provider.ts` —
`MockSearchConsoleProvider implements SEODataProvider` (Epic 4's exact
interface, unchanged). `name: 'search_console'` — the precise
`seo_provider_source` enum value Epic 4 already reserved for it (see that
enum's own doc comment in `schema.prisma`, written before this epic
existed: "names the pre-existing, unused `gsc_connections` OAuth-token
table... as the natural first real provider a future epic would
implement"). Deterministic, zero network calls: `confidence: 'high'`
(vs. `NullSEODataProvider`'s `'estimate'`) and real non-null
`getRankings` positions (vs. always-null) — the two properties that make
selecting it actually observable, not just "a different object got
constructed."

`apps/api/src/lib/seo/resolve-provider-for-org.ts` —
`resolveSEODataProviderForOrg(organizationId)`: reads the org's
`integrations` row for `integration_type: 'gsc'`; returns
`MockSearchConsoleProvider` if `status: 'connected'` and not soft-deleted,
the existing `NullSEODataProvider` singleton otherwise. Fresh DB read every
call — disconnecting takes effect on the very next call. **Wired into the
one real call site**: `apps/api/src/routes/seo.ts`'s `POST
/brands/me/seo/keyword-groups/generate` now calls this instead of the bare
`getSEODataProvider()` — the literal end-to-end flow step 5 requirement
("trace the provider-resolution code, don't just check the connection
record exists"). Kept in its own file rather than added directly to
`seo-data-provider.ts` to avoid a module import cycle (the mock provider
itself imports `classifyIntent` from `seo-data-provider.ts`).

---

## RBAC / audit additions

- `lib/rbac.ts` — new `Action`: `manage_agency_clients` (`owner`, `admin`),
  kept separate from `manage_integrations` (same role list, different
  resource — same reasoning the CRM epic already used to keep
  `manage_leads`/`manage_deals` separate from a coarse `manage_crm`).
- `lib/audit.ts` — `ALWAYS_AUDITED_ACTIONS` gained `agency_client.invited`,
  `agency_client.consented`, `agency_client.revoked`,
  `integration.connected`, `integration.disconnected`. White-label changes
  reuse the existing `settings.changed` action (same as `PATCH
  /orgs/:slug`).

---

## Files touched

**`packages/database`** (schema-only, `prisma validate`/`generate` only):
- `prisma/schema.prisma` — `agency_clients` (5 new columns, widened
  `status` default), `integrations` (2 new columns), `users` (3 new
  back-relations).
- `prisma/migrations/0013_agency_white_label_integrations/checks.sql` —
  new folder, widened `chk_agency_clients_status`.
- `src/client.ts`, `src/index.ts` — export `agency_clients`,
  `white_label_configs`, `integrations`, `integration_type`,
  `integration_status`.
- `DECISIONS.md` — new §23.

**`apps/api`** (new files):
- `src/lib/agency-access.ts` (+ `.test.ts`)
- `src/lib/white-label.ts` (+ `.test.ts`)
- `src/lib/seo/mock-search-console-provider.ts` (+ `.test.ts`)
- `src/lib/seo/resolve-provider-for-org.ts` (+ `.test.ts`)
- `src/routes/agency.ts` (+ `.test.ts`)
- `src/routes/white-label.ts` (+ `.test.ts`)
- `src/routes/integrations.ts` (+ `.test.ts`)

**`apps/api`** (modified):
- `src/middleware/tenant-context.ts` — `resolveOrgContext` composes in
  `resolveAgencyAccess`; `.test.ts` extended (mock + 4 new tests including
  the critical revoke test).
- `src/routes/auth.ts` — `/select-org` composes in the same fallback;
  `.test.ts` extended (mock + 2 new tests).
- `src/routes/orgs.test.ts` — mock extended (`memberships.findMany`,
  `agency_clients`) so `GET /orgs/:slug`'s existing "not a member" test
  still exercises the new fallback path correctly instead of crashing.
- `src/types/context.ts` — `OrgContext` gained optional `viaAgencyOrgId`.
- `src/lib/rbac.ts` — new action + exported `lowerRankRole`.
- `src/lib/audit.ts` — new `ALWAYS_AUDITED_ACTIONS` entries.
- `src/routes/seo.ts` (+ `.test.ts` mock extended) — one call site now uses
  `resolveSEODataProviderForOrg`.
- `src/app.ts` — mounts `/api/agency`, `/api/orgs/me/settings/white-label`,
  `/api/integrations`.
- `src/routes/tenant-isolation.integration.test.ts` — new `describe.skip`
  block (NEEDS LIVE DB) for Epic 18's tenant-isolation scenarios.

**Verification**: `pnpm --filter @bebest/database typecheck/lint/test` and
`pnpm --filter @bebest/api typecheck/lint/test/build` all pass —
`@bebest/database`: 7/7 tests; `@bebest/api`: 630/630 tests passed across
68 files (plus 60 documented `.todo` tenant-isolation scenarios requiring a
live DB), `tsc --noEmit` clean, `eslint` clean, `tsc -p
tsconfig.build.json` clean.

---

## What's not done

- **Bing Webmaster Tools.** `docs/10-seo/SEO_ENGINE.md`'s "Available
  Without Paid APIs" list names both GSC and Bing; only Google Search
  Console is wired end-to-end (the one `MockSearchConsoleProvider`
  backs). Adding Bing is one more `integration_type` enum value + one more
  `PROVIDER_SLUGS` entry + a `MockBingWebmasterProvider` — no other file
  would need to change (documented inline in `routes/integrations.ts`).
- **Real OAuth.** Explicitly out of scope per the epic brief. Both
  `routes/integrations.ts`'s connect handler and
  `mock-search-console-provider.ts` mark their "DEPLOYMENT-TIME
  INTEGRATION POINT" inline.
- **White-label branding is not wired into any report renderer.** Epic 15
  (Reporting/Notifications) has no `-backend.md` yet — it has not been
  built in this codebase as of this epic, so there is no real report route
  to wire branding into. Epic 17's public snapshot page
  (`routes/snapshot.ts`) is a pre-signup, anonymous flow scoped to
  BeBest's own internal ops org (`getInternalOrgId()`) with no customer
  `organization_id` at all — there is structurally no per-customer page
  there to brand. `lib/white-label.ts`'s `resolveWhiteLabelBranding(
  organizationId)` is the ready-made seam for whichever future epic
  becomes that consumer; fabricating a fake consumer today to satisfy the
  letter of the end-to-end flow was judged worse than documenting the real
  gap.
- **`GET /agency/clients` summary is 1-brand-per-org.** Reuses
  `lib/brand-context.ts`'s `getBrandForOrg` (Epic 2's own documented
  "MULTI-BRAND: see Epic 18" scope note) — a client org with multiple
  brands (not supported anywhere else in the codebase either) would only
  summarize its first-created brand.
- **Live-DB tenant-isolation tests are `.todo`**, matching every other
  epic's entries in `tenant-isolation.integration.test.ts` — cannot be run
  under the "no database connections" constraint. The mocked-DB tests
  (`agency-access.test.ts`, `tenant-context.test.ts`, `auth.test.ts`,
  `agency.test.ts`) prove the authorization LOGIC; the `.todo` block
  documents exactly what still needs proving against real Postgres RLS.
- **No email/notification is sent** for an agency invitation or a
  white-label change — same "console.log stand-in, no real EmailSender
  wiring" gap `routes/orgs.ts`'s own team invitations already carry
  (tracked there, not duplicated here).
- **`agency_clients.notes`/`monthly_fee`/`contract_start`/`contract_end`**
  (pre-existing columns from the original business-relationship model)
  are untouched — no route in this epic reads or writes them. They remain
  available for a future billing/CRM-facing view of the same table.
