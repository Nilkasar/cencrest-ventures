# Epic 1 — CRM (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched. Nothing under `api/`, `web-app/`, or the repo-root marketing
site was modified — read-only reference only.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run repeatedly (schema-only, against a placeholder
`DATABASE_URL` so the datasource block resolves — no network connection is
made by either command). No `migrate`, `db push`, or `db pull` was run, per
the hard constraint. No git command was run — the orchestrator owns that.

**This build ran concurrently with another agent's Epic 2 (Brand
Intelligence) work in the same repo.** Both landed schema additions and
`app.ts` route mounts in the same shared files at overlapping times. Every
shared file (`schema.prisma`, `src/client.ts`, `src/index.ts`, `app.ts`,
`lib/rbac.ts`) was re-read immediately before each edit, and both sets of
changes merged cleanly — verified by re-running `prisma validate`,
`tsc --noEmit`, `eslint`, and the full test suite after the fact, not
assumed. One real collision resulted (migration folder numbering) and was
resolved from this side — see "Migration folder numbering" below.

---

## Read first: the one deliberate spec deviation

The spec (`docs/epics/01-crm.md`) says, for `leads`: *"`organization_id`
(set only on conversion)"*, and for `deals`: *"`organization_id` (nullable —
a deal can exist pre-conversion against a lead)."* Taken literally, that
makes `organization_id` on these tables **sometimes null**.

This build does **not** implement it that way, on purpose. `organization_id`
is the same column every other tenant table in this schema uses for
Row-Level Security (`organization_id = current_setting('app.current_org')`)
— a non-negotiable per the architecture brief: multi-tenancy enforced at the
database level, not just app checks. A nullable, dual-purpose
`organization_id` is exactly the shape of column Epic 0's own hardening pass
already found trouble with three times (`background_jobs`, `memberships`,
`organization_rate_limits`, `invitations` — see `@bebest/database`
DECISIONS.md §1/§7a/§7b): it either becomes permanently invisible to any
ordinary database role while null, or needs a bespoke RLS policy, which is
one more place for tenant isolation to be subtly wrong.

**What's actually built:** `leads.organization_id`, `deals.organization_id`,
and `activities.organization_id` are **NOT NULL** and always resolve to one
fixed, well-known org — BeBest's own internal operations tenant (CRM is an
internal ops tool in v1 per the spec's own Entitlements section; no customer
ever sees any of this). The standard `tenant_isolation` RLS policy applies
with zero special-casing. The spec's actual intent — "which real customer
does this lead/deal/activity belong to" — is preserved under an unambiguous
name instead: `leads.converted_organization_id` (set only at conversion,
literally the field the spec calls `leads.organization_id`) and
`deals.account_organization_id` / `activities.account_organization_id` (set
at creation if already known, or backfilled at conversion time). These are
plain nullable FKs with no RLS role of their own.

**If you are `qa-flow-tester` tracing the spec's End-to-end flow step 3**
("`leads.organization_id` and `leads.converted_at` are set") — read that as
`leads.converted_organization_id`. This is the one place implementation and
spec prose diverge in field name; behavior matches the spec's intent
exactly (an org gets created/linked, the lead records it, `converted_at` is
set, activities/deals survive untouched).

Full reasoning, plus every other schema decision below, is in
`packages/database/DECISIONS.md` §14 ("Epic 1 (CRM) schema additions") and
in `schema.prisma`'s own "Epic 1 (CRM) additions" comment block (right above
the `leads` model) — this doc cross-references rather than duplicates.

---

## The gap between the epic spec and the ported schema

Checked `packages/database/prisma/schema.prisma` before writing anything, on
the premise the domain model might already exist from Epic 0's port. It did
not, confirming the spec's own gap analysis:

- **`leads`** — did not exist. The existing `crm_contacts`/`crm_notes`
  tables are a different, already-shipped concept (post-signup contacts and
  free-text notes on an *existing paying org*), not pre-signup leads. Left
  untouched.
- **`deals`** — did not exist under any name.
- **`activities`** — did not exist under any name. (The `actions` table is
  unrelated — GEO/SEO/Growth agent task queue, not a CRM activity log.)
- **`accounts`** — confirmed the spec's own reading is sound: there is no
  hidden `accounts` table anywhere in the 96-model ported schema, and
  nothing about `organizations` needs a parallel entity. Built as a read
  view in `routes/accounts.ts`, not a table. No CRM-specific account fields
  (ARR, renewal date, etc.) came up during implementation, so the spec's own
  fallback (`account_profiles` table) was not needed.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- **Schema additions** (`prisma/schema.prisma`):
  - `leads` — `email`, `name`, `company`, `website`, `category`, `notes`,
    `source` (new `lead_source` enum), `source_url`, `status` (new
    `lead_status` enum), `score` (0-100, CHECK), `assigned_to`,
    `snapshot_id` (FK → `snapshot_requests` — a lead can originate from a
    free-snapshot request), `converted_organization_id` + `converted_at`,
    `created_by`/`updated_by`, standard soft-delete + UUID + UTC timestamp
    hardening (not explicitly listed in the spec's field list, but required
    by the architecture brief's non-negotiables for customer-adjacent data).
  - `deals` — matches the spec's field list (`title`, `value_cents`,
    `currency`, `stage` — new `deal_stage` enum, `probability`,
    `expected_close_date`, `owner_id` → `users`, required, `Restrict`;
    `lost_reason`, `lead_id` nullable, `created_by`/`updated_by`), plus
    `account_organization_id` (the renamed business-link field, see above).
  - `activities` — `type` (new `activity_type` enum), `subject`, `body`,
    `metadata` (Json), `actor_id` (nullable — `snapshot_requested`/`signup`
    can be system-originated with no human actor), `lead_id`, `deal_id`
    (small addition beyond the spec's literal "lead or org" — a deal detail
    screen needs its own activity trail too, see the UI surface table's
    "Deal detail" row), `account_organization_id`.
  - `lead_source` (`free_snapshot`/`apply_form`/`direct`/`referral`),
    `lead_status` (`new`/`contacted`/`qualified`/`converted`/`lost`),
    `deal_stage` (`new`/`qualifying`/`proposal`/`negotiation`/`won`/`lost`),
    `activity_type` (`note`/`email`/`call`/`snapshot_requested`/`signup`) —
    native Prisma enums (Postgres ENUM types), not this schema's
    VARCHAR+CHECK pattern used for softer/extensible taxonomies — these four
    are closed, spec-fixed vocabularies, so the stronger DB-level guarantee
    costs nothing.
  - `organizations`, `users`, and `snapshot_requests` models' relation lists
    updated with the required back-relations (Prisma requires both sides
    declared) — six new named relations to `organizations` alone (tenant
    scope + business-link, for each of the three tables), all documented
    inline.
- **`prisma/migrations/0002_crm/`** (new folder, same
  not-applied-anywhere convention as `0000_init`):
  - `rls.sql` — standard `tenant_isolation` policy (USING + WITH CHECK) for
    `leads`, `deals`, `activities`.
  - `checks.sql` — `leads.score` / `deals.probability` (0-100 range),
    `deals.value_cents` (>= 0), and `activities`' "at least one of
    lead_id/deal_id/account_organization_id" constraint.
  - `indexes.sql` — three partial indexes for the hot query shapes the
    Leads inbox and Deals pipeline screens will actually run (open leads by
    org, open deals by org+stage, open deals by owner+stage).
- **Migration folder numbering.** This folder was originally created as
  `0001_crm` (Epic 1 in the roadmap). The concurrent Epic 2 agent
  independently landed `0001_brand_intelligence` at the same time — same
  slot. Resolved from this side: renamed to `0002_crm` and updated every
  in-repo reference (`schema.prisma`'s two doc-comments, this folder's own
  `rls.sql` header). The Epic 2 agent's own completion doc
  (`docs/epics/02-brand-intelligence-backend.md`) still describes the
  collision as unresolved as of when they wrote it — that's now stale but
  harmless; nothing there needed to change since their folder name
  (`0001_brand_intelligence`) never changed.
- **`DECISIONS.md` §14** (new section, appended after Epic 2's §13) — full
  reasoning for the `organization_id` design decision and every other schema
  addition above.
- **`src/client.ts` / `src/index.ts`** — re-export the new types (`leads`,
  `deals`, `activities`, `lead_source`, `lead_status`, `deal_stage`,
  `activity_type`) so `apps/api` never needs `@prisma/client` directly for
  them.

### `platform/apps/api` (`@bebest/api`)

- **`src/lib/internal-org.ts`** (new) — `getInternalOrgId()`, reads
  `CRM_INTERNAL_ORG_ID` from the environment and validates it's a UUID.
  Deliberately a fixed env var, not a `slug` lookup against `organizations`
  on every request — one fewer query per CRM call, and it can't be spoofed
  by someone creating a same-slug org later. Nothing seeds this org
  automatically (no seed script exists anywhere in this codebase yet); it's
  a one-time manual step documented in `apps/api/README.md`.
- **`src/middleware/crm-access.ts`** (new) — `requireCrmAccess(minRole)`,
  the CRM tenant gate. Composes `requireOrgFromToken` (Epic 0's DB-verified
  tenant-context resolver) with one more check: the org the caller's token
  resolved to must BE the internal ops org, not just any org they belong
  to. Every CRM route uses this instead of `requireOrgFromToken` directly.
- **`src/lib/ssrf-guard.ts`** (new) — `isSafePublicHttpUrl()`, applied to
  `leads.website`/`leads.source_url`. Honest scope note (also in the file's
  own header and in `apps/api/README.md`'s "not done" list): nothing in
  this epic fetches a stored lead URL, so this is defense-in-depth at the
  write boundary (rejects non-http(s) schemes, rejects literal-IP
  loopback/private/link-local addresses) — it is **not** a substitute for a
  real fetch-time SSRF check (which needs post-DNS-resolution validation),
  which whichever future epic actually crawls one of these URLs must add.
- **`src/lib/rbac.ts`** — four new `Action`s: `view_crm` (everyone),
  `manage_leads` / `manage_deals` (owner/admin/analyst), `log_crm_activities`
  (owner/admin/analyst/editor). Kept as separate actions rather than one
  `manage_crm`, specifically because `editor` must land on opposite sides of
  `manage_deals` vs. `log_crm_activities` — `isAtLeast`'s coarse hierarchy
  check cannot express that (`analyst`/`editor` are the same rank).
- **`src/lib/audit.ts`** — two new entries in `ALWAYS_AUDITED_ACTIONS`:
  `lead.converted`, `deal.stage_changed` (noted as Epic 1 additions, since
  SECURITY.md's original list predates this epic).
- **Routes** (all new, all mounted in `src/app.ts` under `/api/leads`,
  `/api/deals`, `/api/activities`, `/api/accounts`):
  - `src/routes/leads.ts` — list (paginated; filter by `status`/`source`/
    `assignedTo`), get, create, update (every field except `status:
    'converted'`, which is rejected — conversion only happens through the
    dedicated endpoint), `POST /:id/convert` (transactional: creates a new
    org OR links an existing one by id, sets `converted_organization_id` +
    `converted_at` + `status: 'converted'`, backfills any deals/activities
    already hanging off the lead to the new org's `account_organization_id`
    so the Accounts view finds them without a lead_id fallback, all inside
    one `withOrgContext` transaction; audited as `lead.converted`).
  - `src/routes/deals.ts` — list (filterable by `stage`/`ownerId`), get,
    create (accepts `leadId` and/or `accountOrganizationId`; inherits
    `accountOrganizationId` from an already-converted lead if the caller
    doesn't supply one), `PATCH /:id` (every field **except** `stage` — the
    schema uses Zod `.strict()` so a `stage` key in the body is rejected
    outright, not silently ignored), `POST /:id/stage` (the *only* way to
    change stage — audited as `deal.stage_changed`; requires `lostReason`
    when moving to `lost`).
  - `src/routes/activities.ts` — create (requires at least one of
    `leadId`/`dealId`/`accountOrganizationId`; `actor_id` always set from
    the authenticated caller), list (by `leadId`, `dealId`, or
    `accountOrganizationId`, time-ordered, paginated).
  - `src/routes/accounts.ts` — list (orgs with a converted lead, newest
    conversion first), get one (`organizations` row + its converted `leads`
    row + every `deals`/`activities` row linked either by
    `account_organization_id` or by `lead_id` — 404s if the org exists but
    no lead ever converted into it, matching the spec's "accounts only
    exist once a lead converts" model decision literally).
  - Every write endpoint Zod-validates its body; `requireCrmAccess('viewer')`
    on every route, `requirePermission('manage_leads' | 'manage_deals' |
    'log_crm_activities')` layered on top for the entity-specific part of
    the matrix.
- **48 new passing vitest tests** across 9 files (`leads.test.ts`,
  `deals.test.ts`, `activities.test.ts`, `accounts.test.ts`,
  `middleware/crm-access.test.ts`, `lib/internal-org.test.ts`,
  `lib/ssrf-guard.test.ts`, plus additions to the existing `lib/rbac.test.ts`),
  all against a mocked `@bebest/database` — no live database anywhere.
- **5 new `it.todo` tenant-isolation stubs**, appended to the existing
  `routes/tenant-isolation.integration.test.ts` under a dedicated
  `describe.skip('CRM tenant isolation — leads/deals/activities (NEEDS LIVE
  DB)', ...)` block — see that file for exactly what must be proven once a
  real Postgres instance exists.

---

## Key design decisions worth surfacing

1. **The `organization_id` scoping decision** — covered at the top of this
   doc; the single biggest deviation, fully reasoned there and in
   `DECISIONS.md` §14.
2. **Stage transitions have exactly one code path.** `PATCH /deals/:id`
   uses Zod `.strict()`, so a client sending `{ "stage": "won" }` to the
   general update endpoint gets a 422, not a silent no-op or an unaudited
   change. `POST /deals/:id/stage` is the only way to move stage, and it's
   unconditionally audited. This directly matches the spec's End-to-end
   flow step 6 ("confirm the stage-transition endpoint is the one actually
   called, not a generic PATCH bypassing the audit-logged transition path")
   — and makes it impossible for a future route change to accidentally
   reopen that gap, rather than relying on code review to keep enforcing it.
3. **`requireCrmAccess` is a tenant gate, not a permission check.** It only
   proves "this caller is a member of the internal ops org at role X" — the
   actual "can this role do this specific thing" question is answered by
   `requirePermission` with the new CRM actions, layered on top. Mirrors
   the existing `requireOrgFromToken` + `requirePermission` split in
   `orgs.ts`/`brands.ts` rather than inventing a new pattern.
4. **`accounts` 404s if no lead ever converted into the org**, even though
   the org itself may exist and be perfectly valid. This is a literal
   reading of the spec's model decision ("an org becomes visible in the
   CRM's Accounts list once a lead converts into it") — a self-serve org
   that never touched the CRM's lead pipeline is real data, but not (yet) a
   CRM "account" in this v1 sense.
5. **A deal can exist against a lead, an account, both, or (rarely) neither
   explicitly known yet** — `leadId` and `accountOrganizationId` are both
   optional at creation, and creating one against an already-converted lead
   auto-inherits the account link. This supports the realistic case of a
   deal created directly against an existing customer (an upsell) with no
   lead in the picture at all, which the spec's "create" verb doesn't rule
   out and the UI surface table's screens (Deals pipeline, Accounts detail)
   both assume is possible.

---

## Entitlements mapping (spec → `lib/rbac.ts`)

| Spec role | `view_crm` | `manage_leads` | `manage_deals` | `log_crm_activities` |
|---|---|---|---|---|
| owner/admin/analyst | yes | yes | yes | yes |
| editor | yes | **no** | **no** | yes |
| viewer | yes (read-only) | no | no | no |

Matches the spec's Entitlements section verbatim ("owner/admin/analyst can
create/edit; editor can log activities but not manage deals; viewer
read-only"). Not gated by `plans.features` — CRM is internal-only in v1, per
the same section.

---

## End-to-end flow — traced against the spec's own numbered list

The spec's End-to-end flow section (`docs/epics/01-crm.md`) has 8 steps.
This build covers the API half of every step; UI-observable claims
("confirm it's readable in the Leads inbox UI") are not checkable without
the frontend half, which is explicitly out of scope here (no frontend
exists for this epic yet).

1. `POST /leads` → 201, lead created with `status: 'new'`, scoped to the
   internal org. ✅ (API only — UI not built.)
2. `POST /activities` against the lead → 201, `actor_id` set from the
   authenticated caller (never null for a route-created activity). ✅
3. `POST /leads/:id/convert` → transactional: creates/links an org, sets
   `converted_organization_id` + `converted_at` + `status: 'converted'`,
   backfills linked deals/activities, writes an `audit_events` row
   (`lead.converted`). All prior activities remain attached (never
   deleted/modified in content, only re-linked). ✅ (field name deviation
   noted at the top of this doc.)
4. `GET /accounts/:orgId` surfaces the org + converted lead + deals +
   activity timeline in one read. ✅ (API only — UI not built.)
5. `POST /deals` against the new account → 201, deal visible via
   `GET /deals?stage=...`. ✅ (API only — pipeline board UI not built.)
6. `POST /deals/:id/stage` is the only stage-change path, and it's audited
   (`deal.stage_changed`). ✅ (drag-and-drop UI not built, but the API
   contract the UI must call is in place and enforced.)
7. RBAC: `editor` can `POST /activities` (201) but gets 403 on
   `POST /deals` and `PATCH /deals/:id`; `viewer` gets 403 on all four
   write surfaces (`leads`/`deals`/`activities` create/update, stage
   transition). Covered by `rbac.test.ts` (matrix-level) and
   `activities.test.ts`/`deals.test.ts` (route-level, per-role). ✅
8. Tenant isolation: covered by the 5 new `it.todo` stubs in
   `tenant-isolation.integration.test.ts` — genuinely NEEDS LIVE DB, not
   provable against a mocked Prisma client (the whole point is proving a
   real Postgres RLS policy rejects cross-tenant access). ⏳ pending a real
   database.

---

## What was NOT done (honest gaps, not oversights)

- **No frontend.** This is the backend half only, per the task brief. The
  Leads inbox / Lead detail / Deals pipeline (kanban) / Deal detail /
  Accounts list-detail screens (`docs/epics/01-crm.md`'s UI surface table)
  are a separate frontend-engineer pass against these endpoints.
- **No integration tests against a live database.** Everything here is
  unit/mock-tested against a fake `@bebest/database`. RLS enforcement for
  `leads`/`deals`/`activities`, and the internal-org-only scoping decision
  specifically, can only be proven once a real Postgres instance exists
  with `0000_init` + `0002_crm`'s SQL actually applied — see the 5 new
  `it.todo` stubs for exactly what to prove.
  - This is a genuine, currently-unverified assumption worth naming
    explicitly: the "always resolves to the internal org" design is only as
    safe as `apps/api` actually setting `organization_id` correctly on
    every write, since the RLS policy itself has no way to know a row
    "should" belong to the internal org — that has to be proven by the
    `chk_activities_target_present`-style CHECK constraints plus the
    integration tests above, not assumed from the application code alone.
- **No apply-form / marketing-site integration.** Explicitly out of scope
  per the spec ("that integration happens in Epic 20"). `POST /leads`
  exists and works; nothing calls it yet outside tests.
- **No seed/bootstrap for the internal operations org.** `CRM_INTERNAL_ORG_ID`
  must point at a real, already-created `organizations` row (create one via
  the existing `POST /api/orgs`, same as any other org). Nothing in this
  codebase creates it automatically — documented in `apps/api/README.md`.
- **Full SSRF protection for stored URLs is not implemented**, only a
  write-time guard (see `lib/ssrf-guard.ts` above) — no epic yet fetches a
  stored lead URL, so there's nothing to protect at request time. Flagged
  explicitly so a future crawler epic doesn't assume this guard is
  sufficient on its own.
- **No OpenAPI/route documentation** — same gap as Epic 0/2, tracked in
  `apps/api/README.md`'s shared "not done" list rather than duplicated here.
- **`account_organization_id`/`converted_organization_id` are `Restrict`
  on delete**, same as every other `organization_id`-shaped FK in this
  schema (§5 of `@bebest/database` DECISIONS.md's blanket rule) — this
  means a customer org can never be hard-deleted while a lead conversion
  record or a deal/activity still references it. Soft-delete is the
  intended path for orgs in this codebase anyway (`organizations.deleted_at`),
  so this rarely matters in practice, but it's worth naming as a deliberate
  choice rather than an oversight.

---

## Commands the user will need to run themselves later

```bash
pnpm install                                    # once, from platform/
pnpm --filter @bebest/database generate         # regenerate Prisma client after any schema change

# Once a real database exists:
pnpm --filter @bebest/database exec prisma migrate dev   # or `migrate deploy` in CI/prod
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/rls.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/checks.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/indexes.sql
# Epic 1 (CRM):
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/rls.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/checks.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/indexes.sql
# (Also apply Epic 2's 0001_brand_intelligence/{rls,checks}.sql if that
# epic's tables are in use — order relative to 0002_crm doesn't matter,
# neither depends on the other.)

# Create the bebest_app / bebest_admin roles per packages/database/src/client.ts's
# top comment, and point DATABASE_URL at bebest_app for the running API.

# Create BeBest's own internal-ops organization (any name/slug), then:
export CRM_INTERNAL_ORG_ID=<that org's id>

pnpm --filter @bebest/api dev                   # run the API
pnpm --filter @bebest/api test                  # run this app's test suite
```

---

## Verification performed in this build (all schema-only / mocked)

- `prisma validate` — schema valid, including the concurrent Epic 2 agent's
  models merged alongside this epic's.
- `prisma generate` — client generates cleanly.
- `prisma format` — run twice (after the schema additions, and again after
  the final renumbering edits) to keep formatting consistent.
- `tsc --noEmit` — clean on both `@bebest/database` and `@bebest/api`.
- `eslint` — clean on both packages' full `src` directories.
- `vitest run` — `@bebest/api`: 175 passing, 13 todo (8 pre-existing Epic 0
  live-DB stubs + 5 new CRM ones), 0 failing, across 24 test files
  (23 run + 1 skip-only file). `@bebest/database`: 7 passing, unchanged.
