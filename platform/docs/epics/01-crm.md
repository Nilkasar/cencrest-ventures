# Epic 1 — CRM (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect (API + data), frontend-engineer (UI). Depends on Epic 0 (auth, orgs, RBAC, tenant context, audit logging) being in place.

## Why this epic, and why first

Every other engine (GEO, SEO, Opportunity, Content, Agents) produces *outputs for a customer that must already exist as a tenant*. The CRM is also the only piece of the product currently losing real value today — the marketing site's apply form fires `alert()` and every lead is lost (`TECHNICAL_DEBT.md` TD-001). Building CRM first gives the platform its first genuinely useful, demonstrable, and revenue-relevant capability, and gives every later epic (billing, snapshot, agency/white-label) a real `leads`/`accounts`/`deals` substrate to attach to.

**Not in scope for this epic**: wiring the live marketing-site apply form to this CRM. That integration happens in Epic 20 (Marketing Site Rebuild), per the agreed build order. This epic ships an internally-usable CRM first.

## Domain model (from `docs/06-database/SCHEMA.md` §5, carried into `packages/database`)

- `leads` — pre-signup contacts. Fields: email, name, company, website, category, notes, `source` (`free_snapshot | apply_form | direct | referral`), `source_url`, `status` (`new | contacted | qualified | converted | lost`), `score`, `assigned_to`, `converted_at`, `organization_id` (set only on conversion), `snapshot_id`.
- `activities` — timestamped events against a lead or an org: `type` (`note | email | call | snapshot_requested | signup`), `subject`, `body`, `metadata`, `actor_id`.
- `accounts` — the converted/paying entity. **Note**: `docs/06-database/SCHEMA.md` doesn't give `accounts` its own CREATE TABLE — it's referenced as "Customer accounts (linked to organizations)" in the architecture doc's schema-groups list but never spelled out. Decision for this epic: **`accounts` is a thin view over `organizations`** for CRM purposes (an org becomes visible in the CRM's Accounts list once a lead converts into it), not a separate table — avoids a duplicate/conflicting source of truth for "who is the customer." backend-architect: confirm this reading is sound before implementing; if a genuine need for CRM-specific account fields beyond what `organizations` holds emerges (e.g. ARR, renewal date), add an `account_profiles` table keyed 1:1 to `organizations.id` rather than a parallel `accounts` entity.
- `deals` — **also referenced in `docs/05-architecture/ARCHITECTURE.md`'s schema-group list but has no explicit schema in `SCHEMA.md`.** Define it now: `id, organization_id (nullable — a deal can exist pre-conversion against a lead), lead_id (nullable), title, value_cents, currency, stage (new | qualifying | proposal | negotiation | won | lost), probability, expected_close_date, owner_id (users.id), lost_reason (nullable), created_at, updated_at, deleted_at, created_by, updated_by`. Stage list matches a standard B2B pipeline appropriate for $24k/$65k/$12k-per-month engagement tiers (`PRODUCT_VISION.md`'s pricing) — a deal is the sales-side tracking of turning a lead into one of those engagements.

## Entitlements (tie into `docs/16-billing/BILLING_ARCHITECTURE.md`)

CRM itself is an internal/ops tool (BeBest staff managing their own pipeline of prospects and customers), not a customer-facing paid feature in v1 — so it is NOT gated by `plans.features`. Access is controlled purely by RBAC role within the (internal) organization: `owner`/`admin`/`analyst` can create/edit; `editor` can log activities but not manage deals; `viewer` read-only. Reassess if/when Epic 18 (Agency/White-Label) requires customer-facing CRM-like views — that's a distinct, later concern (an agency managing *their own clients*, which is a different table shape from BeBest's own sales CRM).

## API surface (backend-architect owns exact routes/shapes)

- `leads`: list (paginated, filter by status/source/assigned_to), get, create (used later by the snapshot/apply-form integration — build the endpoint now even though nothing calls it yet), update, convert (`POST /leads/:id/convert` — transactional: creates/links an `organization`, sets `lead.organization_id` + `converted_at`, preserves all existing `activities` history, does not delete the lead record).
- `accounts`: list/get, backed by `organizations` (per the model decision above) — surfaces org + its converted lead + its deals + its activity timeline in one read.
- `deals`: list (filterable by stage/owner), get, create, update (including stage transitions), a stage-transition endpoint that's audit-logged (`docs/08-security/SECURITY.md` requires this for anything privileged — treat "moved a $65k deal to Won" as privileged).
- `activities`: create (note/email/call log against a lead or org), list (by lead or org, time-ordered).

All tenant-scoped (`organization_id` on every row where applicable — `leads` before conversion are the one exception, scoped instead to the *internal* BeBest organization operating the CRM, which the tenant-context middleware from Epic 0 must account for), RBAC-enforced per the role list above, Zod-validated, with tenant-isolation tests per `docs/19-testing/TESTING_STRATEGY.md`'s hard gate.

## UI surface (frontend-engineer owns exact screens)

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "every screen answers one question" principle:

| Screen | Question it answers |
|---|---|
| Leads inbox | "Who's new, and who needs a response?" |
| Lead detail | "What do we know about this lead, and what's the next step?" |
| Deals pipeline (kanban by stage) | "What's our pipeline worth, and what's stuck?" |
| Deal detail | "What will it take to close this, and who owns it?" |
| Accounts list/detail | "Who are our customers, and what's their history?" |

Empty states: no leads yet → explain the apply-form integration is coming in the marketing-site epic, and offer a manual "add lead" action so the CRM is usable standalone today. No deals yet → prompt to convert a lead or create a deal directly.

## Definition of done for this epic

- Full DoD checklist in `docs/19-testing/TESTING_STRATEGY.md` (tests, tenant isolation, security, docs).
- Lead → conversion → deal → activity flow works end to end when traced through the code (verified by qa-flow-tester without a live DB, per its own constraints) and is ready for a real integration-test run once the user applies migrations against a database.
- `platform/EPICS.md` row for Epic 1 updated to `BUILT (migration pending)`, then `VERIFIED` after qa-flow-tester's pass.
