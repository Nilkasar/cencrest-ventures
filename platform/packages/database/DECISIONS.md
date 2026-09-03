# @bebest/database — decisions vs. the original schema

This package ports `api/prisma/schema.prisma` (96 models, the actual
working implementation — not the simplified illustrative schema in
`docs/06-database/SCHEMA.md`) and hardens it per `docs/08-security/SECURITY.md`
and ADR-005/006/009. This document lists every change, table by table where
it matters, and why. It is the audit trail the completion report
cross-references.

Nothing here was applied to a database. `prisma generate` and
`prisma validate` were run (schema-only, no connection). No `migrate`,
`db push`, or `db pull` was run.

---

## 1. Multi-tenancy: `organization_id` added to every reachable tenant table

The original schema scoped most data through `brand_id` only (e.g.
`competitors`, `keywords`, `pages`, `analyses`, `mentions`, `citations`,
`ai_responses`...), relying on an implicit `brand → organization` join to
enforce tenancy. That means Row-Level Security — which needs a column on
the row itself to filter on — could not be applied to ~50 tables without
either a `USING (brand_id IN (SELECT id FROM brands WHERE organization_id =
...))` subquery policy (slow, and easy to get subtly wrong when a table is
two or three joins away from `brands`) or denormalizing `organization_id`
onto the row.

**Decision:** denormalize `organization_id` onto every table in a brand's
(or a more distant parent's) lineage, in addition to the existing
`brand_id`/parent-id columns. This is the single largest change in this
package. Affected tables (58, on top of the 24 that already had a direct
`organization_id`/`org_id` column):

`analyses, analysis_findings, audiences, autonomous_run_logs, brand_aliases,
brand_categories, brand_keyword_rankings, brand_services, buyer_journeys,
category_associations, citations, competitor_mentions, competitor_visibility,
competitors, content_analyses, content_briefs, crawl_jobs, entities,
experiment_measurements, gap_analysis, generated_content, geo_agent_actions,
geo_gaps, gsc_connections, keyword_clusters, keywords, learning_insights,
learning_signals, measurement_annotations, measurement_points,
mention_extractions, mentions, opportunities, page_issues, pages, products,
prompt_jobs, prompt_runs, query_set_questions, query_sets, questions,
recommendations, reports, responses, runs, score_history, scores,
seo_agent_actions, share_of_voice, visibility_scores, webhook_deliveries,
ai_responses, background_jobs (nullable — see below)`

Every added `organization_id` has its own FK to `organizations` (`RESTRICT`,
see §4) and its own index, so RLS never needs to fall back to a subquery
policy.

**Naming normalization:** the original schema was inconsistent —
`account_health`, `actions`, `autonomous_schedules`, `crm_contacts`,
`crm_notes`, `customer_health_checks`, `entrepreneur_stories`, `experiments`,
`geo_agent_runs`, `growth_agent_runs`, `growth_levers`, `marketing_campaigns`,
`notifications`, `publish_jobs`, `seo_agent_runs` used `org_id`, while
`brands`, `categories`, `integrations`, `intents`, `invitations`,
`memberships`, `org_ai_providers`, `subscriptions`, `usage_records`,
`ai_usage`, `audit_events` used `organization_id`. `white_label_configs`
used `agency_org_id` for what is really just its owning org. All of these
were renamed to `organization_id` for consistency, so one RLS policy
template (`organization_id = current_setting('app.current_org', TRUE)`)
applies uniformly everywhere except the one genuine two-tenant table,
`agency_clients` (see below).

**`agency_clients` — not renamed.** This table represents a relationship
*between two organizations* (`agency_org_id`, `client_org_id`), so it
cannot be collapsed to a single `organization_id`. The RLS policy scopes it
to the agency side only; a client org's "who manages us" view is left as a
narrow, separate read path for a later epic — see `rls.sql`'s header
comment.

**Tables deliberately left WITHOUT RLS** (17 — see §7a/§7b for the two of
these that started out RLS'd and were deliberately walked back):
identity plumbing that is queried *before* a tenant context exists
(`organizations` — `memberships` DOES have RLS, just a non-standard
policy, see §7a), pure user-scoped security artifacts (`users`, `sessions`,
`refresh_tokens`, `magic_link_tokens`, `password_reset_tokens`,
`auth_events`), platform reference data (`ai_providers`, `ai_models`,
`prompt_templates`, `prompt_versions`, `evaluation_datasets`,
`evaluation_items`, `evaluation_runs`, `notification_preferences`),
pre-signup public flows (`form_submissions`, `snapshot_requests`), rate
limiting infra (`organization_rate_limits`, see §7a), and `invitations`
(see §7b — redeemed by an unguessable token before the caller has any org
context to prove). Full reasoning for each is in
`prisma/migrations/0000_init/rls.sql`'s header.

**`background_jobs.organization_id` is nullable.** Some jobs are genuinely
cross-tenant (platform maintenance, evaluation runs). RLS still applies —
a NULL never matches a tenant's `app.current_org`, so tenant sessions
correctly see none of those rows; only a bypass-RLS admin connection does.

---

## 2. Row-Level Security (`prisma/migrations/0000_init/rls.sql`)

- `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` on all 82
  tenant tables. `FORCE` matters: without it, Postgres exempts the table's
  *owner* role from RLS, and in most simple deployments the app's DB role
  is also the table owner (because it ran the migrations) — which would
  silently defeat every policy in production. This is called out explicitly
  in `src/client.ts` because it means the deployment needs a genuine
  non-owning application role (see §7).
- Every policy has both `USING` and `WITH CHECK` (the original design doc's
  example only showed `USING`, which blocks cross-tenant *reads* but would
  still let a buggy query *insert* a row into another org).
- `current_setting('app.current_org', TRUE)` uses the "missing_ok" form, so
  a connection that never set the variable gets `NULL` — and
  `organization_id = NULL` is never true, so the system fails closed (sees
  nothing) rather than throwing or, worse, matching everything.

---

## 3. Soft delete, timestamps, UUIDs

- **`deleted_at` added** where it was missing on user-managed, mutable
  customer data: `keywords`, `pages`, `crm_contacts`, `crm_notes`,
  `integrations`, `growth_levers`, `generated_content`, `content_briefs`
  (already had it), `experiments` (already had it), `white_label_configs`,
  `marketing_campaigns` (already had it), `entrepreneur_stories` (already
  had it). **Deliberately NOT added** to append-only evidence/log/analytics
  tables (`analyses`, `mentions`, `entities`, `citations`,
  `mention_extractions`, `category_associations`, `competitor_mentions`,
  `analysis_findings`, `scores`, `score_history`, `ai_responses`,
  `responses`, `runs`, `prompt_jobs`, `audit_events`, `auth_events`,
  `webhook_deliveries`, agent-run logs) — these are immutable pipeline
  output; "deleting" one is either a GDPR erasure (handled by hard delete
  of the parent chain, see §4) or doesn't happen at all. Adding a
  `deleted_at` nobody would ever set is worse than not having the column.
- **All `DateTime` columns converted to `TIMESTAMPTZ`.** The original
  schema mixed `@db.Timestamp(6)` (no timezone) and `@db.Timestamptz(6)`
  inconsistently across roughly half the tables — a direct violation of
  SCHEMA.md principle #4 ("All timestamps in UTC, stored as TIMESTAMPTZ").
  Every timestamp in the new schema is `Timestamptz(6)`.
- **`ip_address` columns switched from `VARCHAR(45)` to native Postgres
  `INET`** (`@db.Inet`) on `sessions`, `magic_link_tokens`, `audit_events`,
  `auth_events`, `snapshot_requests`) — matches SCHEMA.md's example exactly
  and gets you IP-range query operators (`<<`, `>>`) for free later (e.g.
  rate-limit or abuse analysis by CIDR block).
- UUID PKs via `gen_random_uuid()` were already universal in the original
  schema and are unchanged.

---

## 4. `created_by` / `updated_by`

Added (nullable, `FK → users.id`) wherever a human, not a pipeline, causes
the mutation and it wasn't already tracked:

| Table | Added |
|---|---|
| `brands` | `updated_by` (had `created_by`) |
| `competitors` | `created_by`, `updated_by` |
| `keywords` | `created_by`, `updated_by` |
| `query_sets`, `questions` | `updated_by` (had `created_by`) |
| `content_briefs` | `updated_by`; fixed `created_by` from a free-text `VARCHAR(255)` to a proper nullable UUID FK — it stored things like an email string or `"system"` in the original, which is neither queryable nor a real FK |
| `actions` | `created_by`, `updated_by` (had `assigned_to`) |
| `integrations`, `growth_levers`, `white_label_configs`, `crm_contacts` | `created_by` |
| `marketing_campaigns`, `experiments`, `publish_jobs` | `updated_by` (had `created_by`) |
| `recommendations`, `opportunities`, `gap_analysis` | `updated_by` (status changes — dismiss/snooze/acknowledge — are human actions) |
| `memberships` | `created_by` (nullable — null when the row was created by invitation acceptance rather than a direct admin add) |

**Deliberately not added** to pipeline/agent/AI-generated tables with no
human author (`analyses`, `mentions`, `entities`, `citations`,
`mention_extractions`, `category_associations`, `competitor_mentions`,
`scores`, `score_history`, `ai_responses`, `responses`, `runs`,
`prompt_jobs`, `prompt_runs`, `geo_agent_*`, `seo_agent_*`,
`growth_agent_runs`, `autonomous_run_logs`, `learning_insights`,
`learning_signals`, `measurement_points`, `measurement_annotations`,
`webhook_deliveries`, `usage_records`, `ai_usage`, `background_jobs`,
`evaluation_*`). A `created_by` on a row a `system` actor produced would
either be always-null (dead column) or would have to lie and point at
whichever user happened to trigger the run — worse than not having it.
Attribution for these lives in the parent run/job row's own
`trigger`/`status` fields and, for privileged actions, `audit_events`.

---

## 5. FK `ON DELETE` policy

Original schema: almost everything was `NoAction`, with `Cascade` used
inconsistently for what looks like ad hoc reasons (some genuinely dependent
children, some not).

**New rule, applied uniformly:**

- **Every `organization_id` FK → `Restrict`.** Deleting an organization (or
  a brand) must be an explicit, audited, application-level workflow —
  never a side effect of a single `DELETE FROM organizations WHERE id = …`
  cascading through 80 tables. `RESTRICT` forces that workflow to exist
  (soft-delete the org, then a background purge job, or an explicit admin
  tool) rather than allowing a bug or a bad `DELETE` to silently erase a
  tenant's entire history. Same rule for every `brand_id` FK → `brands`.
- **`Cascade` reserved for true composition children** — a row with zero
  independent meaning once its single, specific parent is gone:
  `analysis_findings/entities/mentions/category_associations/
  competitor_mentions → analyses`; `citations/mention_extractions →
  ai_responses`; `page_issues/content_analyses → pages`;
  `measurement_annotations → measurement_points`; `brand_aliases →
  brands`; `brand_categories/query_set_questions` (both sides — pure join
  rows); `experiment_measurements → experiments`;
  `geo_agent_actions/seo_agent_actions → their agent run`;
  `prompt_jobs → prompt_runs`; `ai_responses → prompt_jobs`;
  `responses → runs`; `webhook_deliveries → integrations`;
  `memberships → organizations` and `→ users`; auth artifacts
  (`sessions`, `refresh_tokens`, `password_reset_tokens`,
  `magic_link_tokens`) `→ users` (safe to cascade — they're security
  tokens, not data of record, and cascading them away on a GDPR erasure is
  exactly correct).
- **`SetNull` for optional references to `users`** (`assigned_to`,
  `approved_by`, most `created_by`/`updated_by` columns, `competitor_id`
  on `gap_analysis`, etc.) — losing the *attribution* when a user account
  is erased is acceptable; losing the underlying business record is not.
  Required (`NOT NULL`) user references that would otherwise need
  `Restrict` (`brands.created_by`, `query_sets.created_by`,
  `questions.created_by`, `reports.created_by`, `crm_notes.author_id`,
  `invitations.invited_by`) stay `Restrict` — a hard user delete is
  expected to reassign or anonymize these rows first, not silently orphan
  or cascade-delete customer data.
- **`crawl_jobs → pages` stays `Restrict`** (changed from the previous
  ambiguity where it wasn't a composition relationship): a page persists
  across many re-crawls; cascading a `crawl_jobs` delete would destroy
  months of tracked page history. Pruning old crawl jobs is left as a
  future epic's explicit re-parenting step, documented here rather than
  solved by a DB cascade that would be wrong 95% of the time.

---

## 6. CHECK constraints (`prisma/migrations/0000_init/checks.sql`)

Prisma's schema DSL has no first-class CHECK constraint syntax (ADR-009
consequence), so these are hand-written SQL, applied after `rls.sql`.
~25 constraints added on genuinely closed, stable-value VARCHAR columns
(`actions.status`/`priority`, `subscriptions.plan` — matched to the actual
`PLANS` object in the old `api/src/lib/plans.ts`, agent run
`status`/`trigger` columns, `growth_levers.status`/`effort_level`,
`recommendations.recommendation_strength`, `experiments.status`/`winner`,
etc.), plus two data-quality checks on `keywords.volume`/`difficulty`
(non-negative / 0–100 range).

**Deliberately NOT constrained:** open, extensible taxonomies —
`action_type`, `integration_type` config internals, `schedule_type`,
`source`/`source_id` polymorphic references, dynamic metric/category names.
Inventing a fixed enum for those would encode a product decision nobody has
made; a CHECK that's wrong is worse than no CHECK (it either blocks a
legitimate future value in production or has to be immediately migrated
away).

---

## 7. Two-role deployment requirement (cannot be provisioned here — no DB access)

`FORCE ROW LEVEL SECURITY` means the table owner is *also* subject to RLS.
For this to work correctly in production, the deployment needs:

- **`bebest_app`** — the role the API connects as for all request traffic.
  Non-owner, no `BYPASSRLS`. Every query it runs against a tenant table is
  subject to the tenant-isolation policy.
- **`bebest_admin`** — the role used only for `prisma migrate deploy`,
  seeding, and offline/admin tooling that legitimately needs cross-tenant
  access (e.g. support impersonation, data exports for compliance).

This package cannot create these roles (Epic 0 never connects to a
database). It is documented here and in `src/client.ts` so whoever runs the
first real migration does not skip it — running the API against a
superuser/owner `DATABASE_URL` would make every RLS policy in this package
inert.

---

## 7a. Three RLS design bugs caught before they shipped

While writing `rls.sql` I designed `memberships` and
`organization_rate_limits` with a plain `organization_id`-based policy like
every other table, then caught real correctness problems on review — worth
recording because they're easy to reintroduce later:

- **`memberships`, round 1** — if scoped by `organization_id = current_org`,
  the post-login "which orgs am I in" call (and the org-switcher) would
  only ever see the single org already selected, because no org is
  selected yet at that point. First fix: switch to a `user_id =
  current_user` policy instead, using a **second** session variable,
  `app.current_user` (set via `withUserContext` in `src/client.ts`).
- **`memberships`, round 2** — that fix broke the OTHER legitimate access
  pattern: "list every member of org X" (an admin managing their team)
  needs to read OTHER users' rows, all within one org — which a policy
  scoped purely by `user_id` can never allow, no matter what
  `app.current_user` is set to. Final fix: the policy is an OR of both
  clauses — `user_id = current_user OR organization_id = current_org`.
  This is safe (not a broadening of access beyond what each caller should
  see) because each clause is independently, correctly scoped on its own —
  see the "Special case — memberships" comment in `rls.sql` for the full
  argument. `apps/api`'s `routes/orgs.ts` calls `withUserContext` for the
  "list my orgs" pattern and `withOrgContext` for the "list this org's
  members" / "change a member's role" / "remove a member" patterns.
- **`organization_rate_limits`** — rate limiting runs before JWT
  verification for auth/public endpoints, and anonymous buckets are keyed
  by IP with `organization_id IS NULL`. A NULL can never satisfy
  `organization_id = current_org`, so an org-scoped RLS policy would make
  anonymous rate limiting silently see zero prior requests forever (the
  limit would never trigger). Fixed: this table has no RLS at all — safety
  comes from the `bucket_key` design instead (a caller can only construct
  its own key). See the comment block in `rls.sql` for the full reasoning.

## 7b. A fourth RLS bug, caught the same way: `invitations`

`invitations` looked like a completely ordinary tenant table — single
`organization_id`, no ambiguity — so it got the standard policy on the
first pass. The bug: accepting an invitation looks it up by its
`token_hash`, and at that moment the caller has no org context to offer
(that's the entire point of an invitation — it's how someone who is NOT
yet a member gets in). With `organization_id = current_org` enforced and
`current_org` unset (or set to some other org the caller already belongs
to), `SELECT ... WHERE token_hash = $1` would return zero rows for exactly
the people invitations exist for, making acceptance permanently broken.

Fixed the same way `magic_link_tokens`/`password_reset_tokens`/
`refresh_tokens` already are: no RLS on this table at all. A sufficiently
random (32-byte), hashed, single-use, expiring token IS the access
control here, not row ownership — the same reasoning already applied
elsewhere in this schema, just missed on the first pass for this
particular table because it "looked like" a normal tenant table at a
glance. `apps/api`'s invitation create/list/cancel endpoints still filter
by `organization_id` in their own `WHERE` clauses; they just don't get a
second, redundant database-level check for it, matching how those other
token tables already worked before this package existed.

## 8. `src/client.ts` — the tenant-context wrapper

- `apps/api` must import everything Prisma-related from `@bebest/database`,
  never `@prisma/client` directly (task requirement) — enforced by
  convention here, not by a lint rule yet (a `no-restricted-imports` ESLint
  rule for `@prisma/client` in `apps/api`'s own config would be a good
  follow-up, tracked in the Epic 0 summary doc's "not done" list).
- `withOrgContext(orgId, fn)` runs `fn` inside `db.$transaction(...)` after
  `SELECT set_config('app.current_org', $1, true)`. `set_config` (a
  function call) is used instead of `SET LOCAL app.current_org = $1`
  because Postgres's `SET` statement does not accept bind parameters —
  `set_config` does, so Prisma's tagged-template `$executeRaw` parameterizes
  it safely. `organizationId` is also validated as a UUID before it ever
  reaches SQL, as defense in depth.
- The third argument to `set_config` (`true`) makes the setting
  transaction-local, so a pooled connection can never leak one request's
  tenant context into the next request that reuses the same connection.
- `withUserContext(userId, fn)` and `withUserAndOrgContext(userId, orgId, fn)`
  are the `app.current_user` equivalents/combination, needed because of the
  `memberships` special case in §7a.

---

## 9. Role enum widened

The original `role` enum was `{owner, admin, member, viewer}` — missing
`analyst`, `editor`, `system`, and `super_admin` from the role matrix in
`docs/08-security/SECURITY.md`. The enum is now
`{owner, admin, analyst, editor, viewer, member}`, with `member` kept only
as a deprecated compatibility alias (documented inline in the schema — do
not use it in new code). `system` and `super_admin` are intentionally
**not** enum values: `system` is never a stored membership role (background
jobs/agents act with no membership row at all — the API layer treats an
absent membership + a service-auth context as `system`), and
`super_admin` is a platform-staff flag checked against a separate allowlist
table/config, not a per-organization membership — a super admin is not a
"member" of every customer's org.

---

## 10. `audit_events` hardened to match SECURITY.md exactly

The original table was missing the `result` (success/failure) and
`actor_type` (user/system/agent) fields SECURITY.md's audit log shape
requires, and had no `actor_role` (the role the actor held *at the time of
the action* — important because roles change later and a log entry should
reflect what was true when the privileged action happened, not what's true
today). All three were added: `result VARCHAR(20) DEFAULT 'success'` (CHECK
`success|failure`), `actor_type VARCHAR(20) DEFAULT 'user'` (CHECK
`user|system|agent`), `actor_role VARCHAR(50)` (nullable, point-in-time
snapshot).

---

## 11. Indexing pass

- Cross-checked against every index listed in `docs/06-database/SCHEMA.md`;
  the equivalents already existed or were added (`idx_opportunities_org_score`
  → `idx_opportunities_org_score_open`, `idx_jobs_status_priority` →
  `idx_background_jobs_queue_pending`, `idx_audit_logs_org_action` →
  `idx_audit_events_org_created`, etc. — table/column names differ slightly
  from the doc's illustrative names because the real schema's table names
  differ from the doc's simplified ones, e.g. there is no single `jobs`
  table, there's `background_jobs`).
- Every new `organization_id` column got its own index (required for RLS
  policy evaluation to use an index scan rather than a sequential scan).
- Partial indexes (`WHERE deleted_at IS NULL`, `WHERE status = 'queued'`,
  etc.) are **not expressible in Prisma's `@@index` syntax** (no `WHERE`
  clause support), so the handful that matter most for hot query paths are
  in `prisma/migrations/0000_init/indexes.sql`: active-brands-only lookup,
  open-opportunities-ranked, pending-job-queue drain, open-actions queue,
  unread-notifications feed, pending-prompt-job dispatch.

---

## 12. What was intentionally left alone

- The 96-model surface area itself (agency/white-label, experimentation,
  learning loop, CRM, evaluation harness, etc.) was ported as-is — this
  package's job was to harden, not redesign, the data model. Any schema
  *additions* beyond hardening (new tables) belong to the epic that owns
  that domain (Epic 1+), not Epic 0.
- `entities`/`entity_type` naming collides conceptually with
  `docs/06-database/SCHEMA.md`'s "Brand Intelligence" `entities` table
  (products/services/concepts) — the real schema's `entities` table is
  actually an AI-extraction artifact (`analysis_id` FK, `confidence`
  score). This is a pre-existing naming ambiguity from the original
  implementation, not something introduced here; flagged for whoever picks
  up the Brand Intelligence epic so they don't accidentally collide table
  names.

---

## 13. Epic 2 (Brand Intelligence) schema additions

This package's job was "harden, don't redesign" (§12), but Epic 2's own spec
(`docs/epics/02-brand-intelligence.md`) needs three things the ported schema
genuinely does not have. Adding them here (rather than working around the gap
in `apps/api`) keeps the same discipline Epic 0 used everywhere else —
tenant-scoped, RLS'd, soft-deleted, UUID-keyed — instead of a one-off.
Nothing here was applied to a database; `prisma validate`/`generate` only
(same rule as §0 above).

- **`brand_entities` (new table).** The epic spec's "entities" concept
  (products/services/concepts the brand should be associated with, typed via
  a schema.org `schema_type`) is NOT the existing `entities` table — that one
  is an AI-extraction artifact with a required `analysis_id` FK and
  `onDelete: Cascade` from `analyses`, i.e. it disappears when the analysis
  that produced it is deleted. Forcing brand-profile CRUD onto that table
  would mean a user's manually-entered entity vanishes the next time an
  unrelated analysis is deleted — silently wrong. This was flagged in
  advance in §12; `brand_entities` is the correctly-scoped new table,
  `entities` is untouched.
- **`use_cases` (new table)** and **`brand_claims` (new table, + new
  `claim_confidence` enum)** — neither existed under any name. Both follow
  the standard brand-child-table shape (`brand_aliases`, `brand_services`,
  etc.): `organization_id` + `brand_id`, both `Restrict`, soft delete,
  `created_by`/`updated_by` (human-authored profile data — unlike the
  AI-pipeline tables in §4's "deliberately not added" list, a person fills
  these in during onboarding, so attribution is real and worth keeping).
- **`competitors.priority` + `competitors.aliases` (new columns on an
  existing table) + new `competitor_priority` enum.** The epic spec
  (mirroring `docs/06-database/SCHEMA.md`) defines competitor priority
  tiering (1=primary/2=secondary/3=watch) and AI-facing name variants as
  core competitor fields; the ported table had neither — only
  `competition_type` (direct/indirect/aspirational), which is a different
  axis (how the competitor competes, not how important tracking it is).
  Modeled as an enum (`primary`/`secondary`/`watch`), consistent with how
  `competition_type` is already handled, rather than a raw `1`/`2`/`3` int a
  caller could pass out-of-range.
- **`chk_subscriptions_plan` fix.** 0000_init's CHECK constraint on
  `subscriptions.plan` was `('free', 'starter', 'growth', 'agency')` —
  missing `'pro'`, even though both `docs/16-billing/BILLING_ARCHITECTURE.md`
  and the Epic 2 spec define a `pro` tier with its own
  `competitors_tracked` limit (20). Fixed forward in
  `prisma/migrations/0001_brand_intelligence/checks.sql` (drop + recreate)
  rather than rewriting the already-committed 0000_init file. Until this
  runs against a real database, inserting `plan = 'pro'` would be rejected
  at the DB layer even though `apps/api`'s entitlement config already
  expects it.
- All three new tables' RLS policies are in
  `prisma/migrations/0001_brand_intelligence/rls.sql`, identical
  `tenant_isolation` template to 0000_init. Whoever runs the first real
  migration needs to apply 0000_init's `rls.sql`/`checks.sql` **and**
  0001_brand_intelligence's, in that order, alongside `prisma migrate
  deploy` — same two-file-per-migration pattern as §2/§6, not automatic.

---

## 14. Epic 1 (CRM) schema additions

Three genuinely new tables: `leads`, `deals`, `activities` (plus enums
`lead_source`, `lead_status`, `deal_stage`, `activity_type`). `docs/06-
database/SCHEMA.md` §5 defines `leads`/`activities` but not `deals`, and
never gives `accounts` its own table at all — see `docs/epics/01-crm.md`'s
model-decision note and `platform/docs/epics/01-crm-backend.md` for the full
resolution (`accounts` ends up being a read view apps/api assembles over
`organizations` + these tables, not a fourth new table).

**The one deliberate deviation from the spec's literal field list, and why:**
the spec describes `leads.organization_id` as "set only on conversion" (i.e.
nullable) and `deals.organization_id` as "nullable — a deal can exist
pre-conversion against a lead." Taken literally, that makes `organization_id`
on these tables sometimes-null, which is exactly the shape of column this
package's own hardening pass (§1's `background_jobs.organization_id`, §7a's
`memberships`/`organization_rate_limits`, §7b's `invitations`) has already
shown is where RLS design mistakes happen — a nullable, dual-purpose
`organization_id` either becomes permanently invisible to any ordinary role
while null, or needs a bespoke policy, both of which are exactly the kind of
special-casing Epic 0 worked hard to avoid everywhere else.

Resolution: CRM is an internal/ops tool in v1 (`docs/epics/01-crm.md`'s
Entitlements section — BeBest staff manage their own pipeline; no customer
ever sees this) — so there is exactly ONE tenant context these tables ever
need to satisfy, the internal BeBest operations org. `organization_id` on
all three tables is **NOT NULL** and always resolves to that one fixed org
(`apps/api` reads its id from `CRM_INTERNAL_ORG_ID` — see that app's
README). This lets the standard `tenant_isolation` policy apply with zero
special-casing. The spec's actual intent (which real customer this
lead/deal/activity is tied to) is preserved under unambiguous names instead:
`leads.converted_organization_id` (set at conversion) and
`deals.account_organization_id` / `activities.account_organization_id` (set
at creation if already known, or backfilled at conversion time) — plain
nullable FKs with no RLS role of their own. Full reasoning is in
schema.prisma's "Epic 1 (CRM) additions" comment block, right above the
`leads` model.

Other additions, all following the standard §1-§6 hardening rules:

- `deals.owner_id` is a required (non-nullable) FK to `users`, `Restrict` —
  matches the "required user reference" rule (§5), same as `crm_notes.author_id`.
- `activities.actor_id` is nullable, `SetNull` — some activity types
  (`snapshot_requested`) can be system-originated with no human actor.
- `leads.score`/`deals.probability` (0-100) and `deals.value_cents` (>= 0)
  get CHECK constraints (no native range type in Postgres) —
  `prisma/migrations/0002_crm/checks.sql`.
- `activities` gets a CHECK requiring at least one of `lead_id`/`deal_id`/
  `account_organization_id` to be non-null — an activity logged against
  nothing is a data-entry bug, not a valid row.
- `lead_source`/`lead_status`/`deal_stage`/`activity_type` are native Prisma
  enums (Postgres ENUM types), not the VARCHAR+CHECK pattern used for softer,
  more-likely-to-grow taxonomies elsewhere in this schema — these four are
  closed, spec-fixed vocabularies (SCHEMA.md §5 / the standard B2B pipeline
  stage list), so the stronger DB-level type guarantee costs nothing.
- RLS/CHECK/index SQL is in its own epic-scoped folder,
  `prisma/migrations/0002_crm/`, same convention as Epic 2's
  `0001_brand_intelligence`. **Numbering note:** this folder was originally
  created as `0001_crm` (Epic 1 in the roadmap); Epic 2 was being built
  concurrently in the same repo and independently landed its own migration
  at `0001_brand_intelligence` first, so this one was renumbered to
  `0002_crm` to resolve the collision — see `0002_crm/rls.sql`'s header.
  Neither folder is a real Prisma-generated migration (hand-written SQL
  only, same as `0000_init`), so nothing was functionally broken by the
  collision either way.
- Nothing here was applied to a database — `prisma validate`/`generate`
  only, same rule as every other section in this document.

---

## 15. Epic 2 QA pass — data-contract fixes between §13's schema and the frontend

A qa-flow-tester-persona review found that §13's Epic 2 schema and the
frontend built against `docs/epics/02-brand-intelligence.md` (per that
frontend's own "Schema reconciliation" note) disagreed on three points.
The frontend was NOT assumed to be correct by default — each was checked
against the actual spec text it claims to follow, and the losing side was
the one fixed. All three changes are to tables added in §13, which have
never been applied to any database (`prisma validate`/`generate` only), so
renaming/retyping columns outright (rather than an additive
deprecate-and-migrate dance) is safe.

- **`brands.industry` (singular) → `industries`/`categories`/`markets`
  (plural arrays).** `docs/06-database/SCHEMA.md` §2's literal `brands`
  DDL is unambiguous: `industries TEXT[]`, `categories TEXT[]`,
  `markets TEXT[]`. §13's note ("the spec's plural fields don't exist —
  only a singular `industry` string... left as-is") treated this as an
  acceptable gap rather than checking whether the *schema* or the *spec*
  was supposed to win — re-reading the spec, the schema was the deviation.
  Fixed: `industry` removed, `industries`/`categories`/`markets`
  (`String[] @default([])`) added. `key_differentiators` was also renamed
  to `differentiators` to match SCHEMA.md's literal column name (it was
  already a `String[]`, so this is a name-only fix, not a type change).
  `apps/api/src/routes/brands.ts`'s Zod schema, serializer, and
  create/update payloads were updated to match; `brands.test.ts` updated.
- **`competitors.priority`: enum → `Int`.** §13 modeled this as a new
  `competitor_priority` enum (`primary`/`secondary`/`watch`), reasoning
  "consistent with how `competition_type` is already handled." Re-reading
  SCHEMA.md's literal DDL line for this exact column —
  `priority SMALLINT NOT NULL DEFAULT 1, -- 1=primary, 2=secondary,
  3=watch` — shows the spec itself chose a numeric SMALLINT, not a string
  enum, and the frontend's `CompetitorPriority = 1 | 2 | 3` (built directly
  against that DDL comment) was right all along. §13's own stated rationale
  ("a raw `1`/`2`/`3` int a caller could pass out-of-range") is handled by
  Zod's `z.union([z.literal(1), z.literal(2), z.literal(3)])` at the API
  boundary instead of a DB enum — validation happens at the same layer
  everything else in these routes is already validated at. Fixed: the
  `competitor_priority` enum removed entirely, `competitors.priority` is
  now `Int @default(1) @db.SmallInt`. `apps/api/src/routes/competitors.ts`
  and `competitors.test.ts` updated; `src/client.ts`/`src/index.ts`'s
  `competitor_priority` type export removed (nothing else referenced it).
- **`use_cases.solutions` — no schema change; the frontend was wrong.**
  SCHEMA.md's `use_cases` DDL has `solutions TEXT[]`, and §13's table
  already matches it exactly. The frontend's `UseCase.solution` (singular
  string) was the actual mismatch — fixed on the frontend side, not here;
  see `platform/docs/epics/02-brand-intelligence-frontend.md`'s
  "Post-verification fixes" section.
- **Plan tiers: `PLAN_TIERS`/`PLAN_LIMITS` were missing `managed` and
  `enterprise`.** `docs/16-billing/BILLING_ARCHITECTURE.md`'s "PLAN TIERS"
  table lists seven tiers (free/starter/growth/pro/agency/managed/
  enterprise); `apps/api/src/lib/entitlements.ts` only had five, and the
  frontend's `Organization["plan"]` union was separately missing `managed`
  (it already had `enterprise`). Both sides fixed to the full seven —
  fixing only enough to resolve the reported mismatch (e.g. adding just
  `managed` to the backend) would have left `enterprise` real-plan
  subscriptions silently downgraded to `free` by `resolvePlanLimits`'s
  fail-safe default, an actual bug distinct from the reported one. Both
  new tiers get `competitors_tracked: null` (unlimited) in `PLAN_LIMITS`,
  the same documented placeholder already used for `agency` — Epic 16
  doesn't give either a concrete number (custom SLAs, by definition), so
  `null` isn't a guess, it's the accurate "not a flat number" answer. The
  `chk_subscriptions_plan` CHECK constraint (§13, then already-fixed-forward
  once for `'pro'`) needed the same two values; rather than editing
  `0001_brand_intelligence/checks.sql` again, the fix is forward in a new
  `prisma/migrations/0003_epic2_contract_fixes/checks.sql` (0002 is CRM's,
  per §14) — same "fix forward, don't edit an already-committed migration
  file" rule §13 itself established.
- As with every other section: `prisma validate`/`generate` only, nothing
  applied to a database.

---

## 16. Epic 5 (Intent & Query Universe) schema additions

`docs/epics/05-intent-query-universe.md`'s domain model points at
`docs/06-database/SCHEMA.md` §3's literal `query_sets`/`queries` DDL. The
ported schema already had a `query_sets` table (hardened in §1's
`organization_id` denormalization pass) but was missing three columns that
DDL requires: `query_count INTEGER NOT NULL DEFAULT 0`, `version INTEGER
NOT NULL DEFAULT 1`, `status VARCHAR(50) NOT NULL DEFAULT 'draft'`. Added
per the same "audit against the epic spec, fix forward" rule §13/§15 used
— not a redesign, filling a documented gap.

**`queries` is a genuinely new table, not a repurposing of the ported
`questions`/`query_set_questions` pair.** That pair is a many-to-many join
(a `question` can sit in several `query_sets`) built for the legacy
`questions -> runs -> responses` AI pipeline, with none of
`intent_type`/`category`/`tags`/`priority` — fields the epic's template
generator and its "group the review UI by the ten categories" surface
cannot work without. `docs/epics/07-ai-visibility-engine.md`'s own domain
model independently confirms the split: it defines brand-new
`ai_runs`/`ai_responses`/`brand_observations` tables (not the legacy
`runs`/`responses`) that consume a query_set's `queries` directly — so
`questions`/`query_set_questions`/`runs`/`responses` are left untouched,
same treatment §12/§13 gave the pre-existing `entities` table when
`brand_entities` was added for Epic 2. `queries.query_set_id` is therefore
a direct one-to-many FK per the DDL's literal
`query_set_id UUID NOT NULL REFERENCES query_sets(id)` — Cascade on
delete (§5's "true composition child" rule: a query has zero independent
meaning once its query_set is gone, same as `query_set_questions`).

**Pre-existing gap fixed while touching `query_sets` for this epic:**
it had no index on `organization_id` at all, even though it's one of the
58 tables in §1's denormalization list that's supposed to get one (§11 —
required for RLS policy evaluation to use an index scan). Added
`idx_query_sets_organization` alongside this epic's other changes rather
than leaving it as a second, unrelated gap for a future epic to trip over.

**CHECK constraints, closed vs. open taxonomies** —
`prisma/migrations/0004_query_universe/checks.sql`:
- `query_sets.status` (`draft`/`active`/`archived`) and
  `queries.intent_type` (`informational`/`commercial`/`comparison`/
  `transactional`) both get a CHECK: genuinely closed, stable vocabularies,
  same rule §6 applied to `subscriptions.plan`/`actions.status`.
- `queries.category` — deliberately left UNCONSTRAINED even though the
  epic documents exactly ten template categories. Those ten are what the
  TEMPLATE GENERATOR emits; the epic's own "manual add" surface (human
  curation, called out as a paid-tier feature) must be able to tag a
  hand-added query with any label without the database rejecting the
  insert. This is the `queries.category` case for §6's "deliberately not
  constrained" rule, not a closed enum.
- `queries.priority` (1=high/2=medium/3=low) — no DB-level CHECK, same
  precedent as `competitors.priority` (§15): a plain ranking int, validated
  by Zod at the API boundary in `apps/api/src/routes/query-sets.ts`, not a
  closed taxonomy enforced in the schema.

**RLS** — `prisma/migrations/0004_query_universe/rls.sql` adds the one new
policy this epic needs (`queries`); `query_sets` already had its
`tenant_isolation` policy from `0000_init` and the new columns don't change
that.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption of these two tables
(the template generator, entitlement cap, generate/activate/archive/manual
CRUD routes) is documented in
`platform/docs/epics/05-intent-query-universe-backend.md`.

## 17. Epic 3 (Website Intelligence / Crawler) schema additions

Unlike Epic 2/5, this epic's three core tables (`crawl_jobs`, `pages`,
`page_issues`) already existed in the ported schema — Epic 0's
denormalization pass (§1) had already added `organization_id` to all
three. `docs/epics/03-website-intelligence.md`'s domain model section says
this schema group is "not detailed in SCHEMA.md, define now" — i.e. the
epic spec's own literal field list is the actual source of truth here,
same rule §13/§15/§16 all used — and against that list, the ported tables
had real gaps, not just naming quibbles:

- **`crawl_jobs.root_url` did not exist at all.** A genuine functional
  gap: without it, nothing records which URL a job actually crawled,
  independent of whatever `brands.website_url` says *now* — a brand-profile
  edit after a crawl completes would otherwise silently rewrite history.
  Added as a required `VarChar(2048)`, captured at job-creation time by
  `apps/api`.
- **`crawl_jobs.status` (`crawl_status` enum)** was `pending | running |
  completed | failed | cancelled`; the spec's literal list is `queued |
  running | completed | failed`. `pending` renamed to `queued` to match
  the spec's word exactly. `cancelled` kept as an additive extra value (a
  real state a future "cancel this crawl" action needs somewhere to land),
  not a spec deviation — nothing currently sets it.
- **`crawl_jobs` had `pages_found` but no `pages_failed`**, and an
  `error_message` column where the spec's literal name is `error`. Added
  `pages_failed Int @default(0)`; renamed `error_message` → `error`.
  `pages_found` (total links discovered so far, independent of failure
  count) is kept additively — genuinely useful for progress-percentage
  math, not a naming collision with anything the spec defines.
- **`crawl_jobs.created_by` (new, nullable, `SetNull`)** — added per §4's
  rule: triggering a crawl is a human action (the "crawl" button), unlike
  every subsequent status transition, which the pipeline itself makes —
  same reasoning as `query_sets.created_by`, not the "pipeline table, no
  human author" case.
- **`page_issues.severity` (`issue_severity` enum)** was `critical |
  warning | info`; the spec's literal list is `low | medium | high`.
  Changed the enum's values outright (schema never applied to a database,
  so this is a rename, not a migration).
- **`pages.canonical` renamed to `pages.canonical_url`** to match the
  spec's literal field name (name-only fix, same type).
- **`pages.raw_html_hash` did not exist** (the spec's explicit "dedupe"
  field). Added as `VarChar(64)` (a SHA-256 hex digest), with its own
  index for dedupe lookups. **`pages.schema_types` (`String[]`, already
  present) was kept instead of adding the spec's literal
  `has_schema_markup` boolean** — a boolean that only ever equals
  `schema_types.length > 0` would be a denormalized column that can drift
  from the array it's summarizing; `apps/api`'s serializer computes
  `hasSchemaMarkup` from the array at read time instead. Same instinct as
  §15's `competitors.priority` fix (prefer the representation that can't
  disagree with itself over a second column that duplicates it).
- **`sitemaps` is a genuinely new table** — didn't exist under any name.
  Modeled as an upsert-per-URL reference record (`@@unique([brand_id,
  url])`), not an append-only history row per crawl — a sitemap URL's row
  means "the last time we looked, this sitemap had N URLs," refreshed in
  place on each re-crawl. No `created_by`/`updated_by` (discovered and
  refreshed by the crawler itself, not human-authored — §4's "pipeline
  table" rule) and no `deleted_at` (nothing here is user-managed data that
  needs an undo; if a sitemap disappears from a site, the next crawl
  simply stops refreshing `last_fetched_at` for it).

**RLS** — `prisma/migrations/0005_website_intelligence/rls.sql` adds the
one new policy this epic needs (`sitemaps`); `crawl_jobs`/`pages`/
`page_issues` already had their `tenant_isolation` policy from `0000_init`,
and none of the field changes above touch `organization_id`, so no RLS
change was needed for those three. **Indexes** —
`prisma/migrations/0005_website_intelligence/indexes.sql` adds one partial
index, `idx_crawl_jobs_queue_pending` (`WHERE status = 'queued'`),
mirroring `idx_background_jobs_queue_pending`'s pattern for "which jobs are
waiting to run" — not expressible in Prisma's `@@index` DSL (§11's
recurring reason for a hand-written indexes.sql file).

**Migration numbering note**: this folder was going to be `0004_website_
intelligence`, but Epic 5 was being built concurrently in the same repo and
landed its own migration at `0004_query_universe` first — renumbered to
`0005_website_intelligence` to resolve the collision, same situation (and
same resolution) as §14's CRM/`0001`→`0002` renumbering.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption of these four tables (the
SSRF-safe crawler, the trigger/status/pages routes) is documented in
`platform/docs/epics/03-website-intelligence-backend.md`, including a
"Frontend contract reconciliation needed" section for the enum/field-name
mismatches this fix-forward pass creates against the Epic 3 frontend,
which was built earlier against the pre-fix-forward ported schema.

## 18. Epic 5 (Intent & Query Universe) post-verification fixes

A qa-flow-tester-persona review of Epic 5's completed backend+frontend
halves (§16 above) found the frontend never wired to the real API, a
frontend/backend contract mismatch, and two real backend bugs. The schema
side of that fix:

**`query_sets` gains five columns** the frontend's
`apps/web/src/data/query-universe/types.ts` `QuerySet` interface required
but the backend never persisted: `plan_tier`, `plan_limit`,
`potential_count`, `activated_at`, `archived_at`. Each was checked against
the review UI (`query-set-summary-card.tsx`, the empty-state's version
history table) before being added — every one of them is genuinely
rendered (the plan/cap meter, the "capped by plan — N possible" copy, the
"Activated"/"Archived" timestamps), not speculative. The other two fields
the frontend type had (`brandId`, `organizationId`) were checked the same
way and found NOT displayed anywhere — those were removed from the
frontend type instead of added here (see
`docs/epics/05-intent-query-universe-frontend.md`'s "Post-verification
fixes" section); `query_sets.brand_id`/`organization_id` themselves are
untouched, still required for tenant scoping, just no longer serialized to
the client.

`plan_tier`/`plan_limit`/`potential_count` are frozen at `generate` time
(read from `resolvePlanLimits` once, written onto the row), not re-resolved
from `subscriptions` on every read — the frontend type's own doc comment
explains why: "so the review screen can always explain 'why 500 and not
more' even after the org's plan changes later." For a plan with no
configured cap (`queries_per_query_set: null` — agency/managed),
`plan_limit` is set to `potential_count` rather than some unlimited
sentinel: the frontend type has no "unlimited" case, and semantically
correct behavior for "no cap applied" is "the limit equals what was
actually produced," not infinity.

**`queries` gains one column**: `source` (`generated`/`manual`). Checked
the same way — `category-section.tsx` and the "All queries" table both
render a "Manual" badge off `query.source === "manual"`, so this is real
UI, not the frontend's speculative addition it was flagged as in §16/the
frontend completion doc. Added as a real, CHECK-constrained column instead
of dropping it from the frontend type.

**`intent_type`/`category` reconciliation**: the frontend's `Query` type
has both as non-nullable; the ported columns are nullable. Left NULLABLE at
the schema layer (open for a hypothetical future direct-write path), but
`apps/api/src/routes/query-sets.ts`'s write routes now guarantee a non-null
value on every row this epic's own API creates — `generate` always sets
both from the template category mapping; manual add now requires
`category` in its Zod schema and derives `intentType` from
`query-generator.ts`'s exported `CATEGORY_META` when the caller omits it.
Nullability is reconciled at the API boundary, not by adding a NOT NULL
constraint the legacy-shaped nullable columns don't otherwise need.

**CHECK constraints** — `prisma/migrations/0006_epic5_postverification_
fixes/checks.sql`: `chk_query_sets_plan_tier` (all 7 `PlanTier` values —
deliberately the full list, not the 4-value list
`chk_subscriptions_plan` allows; `plan_tier` is a snapshot copy, not FK-tied
to `subscriptions.plan`, so it isn't limited by that column's own
pre-existing, unrelated gap) and `chk_queries_source`
(`generated`/`manual`). `plan_limit`/`potential_count` get no CHECK — plain
non-negative counts, same precedent as `query_count`.

**Indexing**: added `idx_query_sets_brand_status` (composite
`[brand_id, status]`) — the single-active-query-set fix (below) queries
"every other active query_set for this brand" on exactly that predicate;
the two existing single-column indexes on `brand_id` and `status`
separately don't serve a combined-predicate query as well as one composite
index does.

**The two backend bugs themselves are `apps/api` route logic, not schema**
(single-active-set enforcement on `PATCH /:id/activate`; the entitlement
check missing from manual `POST /:id/queries`) — see
`docs/epics/05-intent-query-universe-backend.md`'s "Post-verification
fixes" section for both.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database.

---

## 19. Epic 7 (AI Visibility Engine / GEO core) schema additions

`docs/epics/07-ai-visibility-engine.md`'s domain model points at
`docs/06-database/SCHEMA.md` §3 and calls for three brand-new tables:
`ai_runs`, `ai_responses`, `brand_observations`. The first and third are
genuinely new (added below). The second is where this epic hit a real
naming collision, not a naming quibble:

**`ai_responses` was already taken.** The ported schema (Epic 0) already
has a `model ai_responses` — the legacy `questions -> prompt_jobs ->
ai_responses` pipeline, FK'd from `citations` and `mention_extractions`
(`onDelete: Cascade` from `ai_responses` on both) and itself FK'd to
`prompt_jobs`/`buyer_journeys`. That table is explicitly NOT this epic's
table: this epic's own spec text says so directly ("it defines brand-new
`ai_runs`/`ai_responses` tables (not the legacy `runs`/`responses`)"), but
the literal name it then uses for its own table is the one name already in
use. Same situation, same resolution, as Epic 2's `entities`/
`brand_entities` split (§12/§13) and Epic 5's `queries` vs
`questions`/`query_set_questions` split (§16): the OLD table is left
completely untouched — it is still load-bearing for `citations`/
`mention_extractions`' own FKs, and nothing in this epic reads or writes it
— and THIS epic's per-(query x provider) response table gets a
disambiguating name instead: **`ai_run_responses`**. Every route, service,
and doc this epic's backend writes uses that name; see
`platform/docs/epics/07-ai-visibility-engine-backend.md` for the full API
surface built on top of it.

**Table shapes**, all following the standard hardening rules (`organization_id`
+ `brand_id` denormalized, RLS FORCEd, indexed):

- **`ai_runs`** — one execution of a query_set across a set of providers.
  `providers String[]` snapshots the resolved provider name list at PREPARE
  time (never re-read from the routing table later, so a historical run's
  claim about what it queried can't silently drift if the routing table
  changes). `status` is `queued | running | completed | failed` — the same
  VARCHAR+CHECK pattern as `crawl_jobs.status` (§17), not a native enum,
  consistent with §6's rule for closed-but-evolving vocabularies. The four
  formula v1.0 components (`mention_score`/`recommendation_score`/
  `position_score`/`coverage_score`) are stored as their own columns
  alongside the composite `ai_visibility_score`, not just the composite —
  this is what lets `GET /ai-runs/:id/score` return a breakdown that
  *provably* sums to the stored total under the stated weights (the epic's
  evidence-traceability requirement) by reading back the exact numbers that
  produced it, rather than recomputing from raw observations on every
  request and hoping the recomputation agrees. `query_sets` FK is
  `Restrict` (not `Cascade`): a query_set is never hard-deleted in this
  codebase (archive is a status flag — §16), so this is the same
  defense-in-depth default every other non-composition FK in this schema
  uses (§5), not a claim that the cascade case is actually reachable.
  `created_by` is required + `Restrict` (triggering a run is a human
  action, same as `crawl_jobs.created_by` — §17).

- **`ai_run_responses`** — one (query x provider) execution's result.
  `raw_response` is written the moment the GEO-query provider call itself
  succeeds; `extraction_status`/`extraction_error`/`extracted_at` are the
  ONLY columns a later extraction step ever touches, and only via UPDATE,
  never by rewriting `raw_response`. This split is what makes "evidence is
  never lost when extraction fails" a property of the schema and pipeline
  ordering, not just a promise kept by careful application code — see
  `platform/docs/epics/07-ai-visibility-engine-backend.md`'s pipeline
  section for exactly how `apps/api` sequences the two provider calls.
  `ai_run_id` FK is `Cascade` (true composition child of its run, same rule
  §5 gives `citations`/`mention_extractions -> ai_responses` on the legacy
  table); `query_id` FK is `Restrict` (a query outlives any one run's
  reference to it). `request_id`/token/latency columns are nullable —
  deliberately, because a response row created from a thrown
  `ExtractionValidationError` (the `@bebest/ai-provider` error type) only
  gives back the last raw text, not a full `CompletionResult`, and that
  case still needs a real row (the raw text IS the evidence being
  preserved), not a rejected insert.

- **`brand_observations`** — the ADR-004 boundary table: LLMs write this,
  nothing else, and only deterministic formulas ever read it for scoring.
  `ai_run_response_id` is `@unique` (1:1 with `ai_run_responses`) so a UI
  can always walk score -> observation -> the exact single raw response it
  came from, per `docs/11-geo/GEO_ENGINE.md`'s evidence-trace example.
  Column set is `docs/12-ai/AI_ARCHITECTURE.md`'s `BrandObservation`
  interface transcribed field-for-field (snake_case). `extraction_confidence`
  reuses the Epic 2 `claim_confidence` enum (`high`/`medium`/`low`) instead
  of adding a second enum with the identical vocabulary — same "don't
  duplicate a closed vocabulary that already exists under a generic enough
  name" instinct as every other reuse decision in this document.
  `brand_sentiment` is deliberately NOT the legacy `sentiment_val` enum:
  that enum lacks `mixed`, which this epic's spec requires, and widening a
  shared enum to satisfy one new table risks changing behavior for the
  unrelated tables (`mention_extractions`) already built against its
  current three values — a plain VARCHAR+CHECK avoids both problems. No
  `created_by`/`updated_by`/`deleted_at` on this table: AI-authored,
  immutable pipeline output, the same "deliberately not added" precedent
  §3/§4 already established for `mention_extractions`/`citations`.

**CHECK constraints** — `prisma/migrations/0008_ai_visibility_engine/checks.sql`:
`ai_runs.status`, `ai_run_responses.extraction_status`,
`brand_observations.brand_sentiment`/`brand_recommendation_strength` (closed
vocabularies), plus a numeric-range CHECK on
`brand_observations.brand_first_position` (`0 <= x <= 1`) — this one is a
real correctness guard, not just documentation, because an out-of-range
value would silently corrupt the deterministic PositionScore formula
(`average(1 - first_position) x 100`).

**RLS** — `prisma/migrations/0008_ai_visibility_engine/rls.sql` adds the
standard `tenant_isolation` policy to all three new tables; nothing about
the legacy `ai_responses`/`prompt_jobs` tables' own RLS changes.

**Indexing** — `prisma/migrations/0008_ai_visibility_engine/indexes.sql`
adds one partial index, `idx_ai_runs_queue_pending` (`WHERE status IN
('queued', 'running')`), mirroring `idx_crawl_jobs_queue_pending`'s pattern
— not expressible in Prisma's `@@index` DSL (§11's recurring reason for a
hand-written indexes.sql file). Nothing currently polls by it (the pipeline
runs inline via `setImmediate`, same documented placeholder §17 used for
the crawler — see the backend doc's "not done" list), but it's here for the
day a real worker does.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption of these three tables (the
PREPARE/QUEUE/EXECUTE/AGGREGATE pipeline, the AVS formula implementation
and its unit tests, the four routes) is documented in
`platform/docs/epics/07-ai-visibility-engine-backend.md`.

## 20. Epic 4 (SEO Intelligence) schema additions

`docs/epics/04-seo-intelligence.md`'s domain model section is explicit that
`docs/06-database/SCHEMA.md` never gave `keyword_groups`/`keywords`/
`seo_analyses`/`seo_opportunities` their own `CREATE TABLE` statements the
way it did for Identity/Brand/GEO/Opportunity/CRM/Billing — "define them
now." Same "audit against the epic spec, fix forward" discipline §13/§16/
§17/§19 all used.

**The `keywords` naming collision — resolved the same way §16 resolved
`queries` vs. the ported `questions`/`query_set_questions` pair.** The
ported schema already has a `keywords` model — `brand_id`-scoped, column
named `keyword` (not `text`), no `confidence` field, no `keyword_group_id`
— built for the not-yet-implemented autonomous SEO agent pipeline
(`seo_agent_actions.keyword_id -> keywords`, `brand_keyword_rankings`,
`keyword_clusters`). A grep of `apps/api/src` before writing this section
confirmed zero route references to any of those four legacy tables, so —
per §12's "harden, don't redesign" rule — they are left untouched for
whichever future epic builds that agent; repurposing `keywords` would mean
either breaking its already-modeled `seo_agent_actions`/
`brand_keyword_rankings` shape or smuggling a second, incompatible meaning
onto the same table name. The epic's literal `KeywordData` shape
(`docs/10-seo/SEO_ENGINE.md`) is implemented as a genuinely new table
instead, named `seo_keywords` at the Prisma/table level (its API-facing
resource name is still "keywords" — `routes/seo.ts`'s
`/keyword-groups/:id/keywords` endpoints — only the underlying table name
differs from the legacy one to avoid the collision). `keyword_groups` (also
new) is its one-to-many parent, matching the spec's literal
`id, organization_id, brand_id, name, created_at, updated_at` field list
(plus the standard `created_by`/`updated_by`/`deleted_at` hardening
trio, since a human can both generate AND manually rename/delete a group —
this is mutable, human-touched brand-child data, not pipeline output).

**Two existing enums are reused as-is** (exact value match — no need to
duplicate): `keyword_intent` (`informational|navigational|commercial|
transactional`, already on the legacy `keywords` table) for
`seo_keywords.intent`, and `opportunity_status` (`new|in_progress|
completed|dismissed`, already on the legacy `opportunities` table) for
`seo_opportunities.status` — the API surface's "list, get, dismiss" maps
directly onto that enum's existing values, and `docs/09-ux/
CUSTOMER_JOURNEY.md`'s Opportunities screen ("Status: open / in progress /
complete / dismissed") independently confirms the same four-state
vocabulary is what the UI needs across BOTH engines, which is exactly the
point of keeping SEO's opportunity shape close to what Epic 9's unified
Opportunity Engine will define (the epic spec's own instruction).

**Two genuinely new enums, and why they are not reuses of a same-named-
looking existing one:**
- `seo_keyword_confidence` (`high|medium|low|estimate`) — NOT a reuse of
  `claim_confidence` (`high|medium|low`, no `estimate`). Different concept
  (a brand claim's evidential confidence vs. a keyword metric's
  data-quality confidence) that only coincidentally shares three of four
  values; reusing it would mean either adding `estimate` to a table this
  epic has nothing to do with, or leaving `seo_keywords` unable to express
  the one value the epic's end-to-end flow step 2 explicitly requires
  ("never silently presenting an estimate as a firm number").
- `seo_provider_source` (`null_provider|search_console|dataforseo|semrush|
  ahrefs|serper|manual`) — names the concrete `SEODataProvider`
  implementations (`apps/api/src/lib/seo/seo-data-provider.ts`).
  `null_provider` is the only one actually wired; `search_console` names
  the pre-existing, unused `gsc_connections` OAuth-token table as the
  natural first real provider a future epic would implement;
  `dataforseo`/`semrush`/`ahrefs`/`serper` are the epic doc's own
  "Abstracted (Optional Paid Providers)" table, transcribed. `manual` was
  added (not in the epic doc's provider list, since a human isn't a
  "provider") so the spec's own "keywords: CRUD" requirement — a human
  manually adding one keyword, distinct from the generate action — has a
  value to write here at all; same precedent as the legacy `keyword_source`
  enum, which already mixes real providers with `manual`/`csv_import` for
  the identical reason. Closed enum, not the open-VARCHAR treatment
  `queries.category` got, because this is a fixed, code-defined set of
  integrations, not an open user-facing taxonomy.

**`seo_analyses`** — `id, organization_id, brand_id, page_id (nullable, ->
pages), analysis_type (technical|content), score, findings (JSONB),
analyzed_at`, matching the spec's literal field list exactly. New enum
`seo_analysis_type` (`technical|content`) — a genuinely closed, two-value
vocabulary. No `deleted_at`/`created_by`/`updated_by` — append-only pipeline
output (§3/§4's "immutable pipeline output" rule), same treatment as the
already-ported `analyses`/`content_analyses` tables. `page_id` is `SetNull`
on delete (not `Cascade`) — unlike `page_issues -> pages` (a true
composition child, §5), an analysis ROW documenting a point-in-time score
has independent historical meaning even if the specific page row it was
computed against is later hard-deleted; losing the specific-page
attribution is acceptable, losing the score history is not.

**`seo_opportunities`** — matches the spec's literal field list
(`id, organization_id, brand_id, keyword_id (nullable), title,
opportunity_type, value_score, effort_score, opportunity_score,
scoring_formula_version, status`), plus `evidence` (JSONB) and
`updated_by` — both taken from the EXISTING `opportunities` table's own
shape (the epic spec's explicit instruction: "keep the shape close to the
opportunities table Epic 9 will define... so the merge is mechanical, not a
redesign"). `updated_by` follows §4's "status changes — dismiss/snooze/
acknowledge — are human actions" rule already applied to the legacy
`opportunities`/`gap_analysis` tables. `evidence` holds the formula's four
raw inputs (`demandScore`, `currentCoverage`, `contentComplexity`,
`technicalDifficulty`) — NOT their own columns, because nothing outside
this JSON blob needs to query on them independently, and the UI surface's
"each opportunity shows its evidence... not just a bare number" requirement
is exactly what a legacy `opportunities.evidence`-shaped JSONB blob is for.
`opportunity_type` stays an open, unconstrained `VARCHAR` rather than an
enum — the spec's own literal list ends in "..." (`service_page |
comparison_page | use_case_page | faq_page | ...`), an explicit signal this
is meant to be extensible, same "deliberately not constrained" treatment
§6 and the `queries.category` precedent (§16) give every other open-ended
classification column in this schema.

**`issue_type` gains two new values** (`not_https`, `missing_schema`) —
purely additive, existing values/ordinal positions unchanged. The Page
Analysis Checklist's "Technical: HTTPS" and "Schema" sections have no
existing representation: Epic 3's crawler (verified by reading
`lib/crawler/engine.ts` before adding these, per the task's "do not guess"
instruction) already derives every OTHER checklist violation as a
`page_issues` row at crawl time (`missing_title`, `title_too_long`,
`duplicate_title`, `missing_meta`, `meta_too_long`, `missing_h1`,
`missing_canonical`, `thin_content`, `noindex`, `missing_alt`,
`broken_link`) but never checks HTTPS or schema.org markup. Safe to widen
even though Epic 3 is otherwise DONE/committed, because this schema has
never been applied to any database — see
`apps/api/src/lib/seo/technical-checklist.ts` for where these two values
are produced and its header comment for the full checklist-coverage
accounting (including which checklist items are NOT implementable from
data `pages` actually stores, and why).

**RLS** — `prisma/migrations/0007_seo_intelligence/rls.sql` adds the
standard `tenant_isolation` policy to all four new tables (unlike Epic 3's
migration, none of the four inherit a policy from an earlier migration —
every one of them is genuinely new, so there is no "already had it from
0000_init" case here). **CHECK constraints** —
`prisma/migrations/0007_seo_intelligence/checks.sql`: the same
non-negative/0-100-range pair the legacy `keywords` table already has, now
on `seo_keywords.monthly_volume`/`difficulty`; a 0-100 range check on
`seo_analyses.score` and all three `seo_opportunities` formula-output
columns (the formula's own "normalized to 0-100" instruction, enforced at
the DB layer too, not just in application code); a non-empty check on
`scoring_formula_version` (so a future v1.1/v2.0 stays introducible without
a schema migration to widen a closed `IN (...)` list).
`seo_opportunities.opportunity_type` deliberately gets no CHECK — see
its own paragraph above.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption of these four tables (the
`SEODataProvider` abstraction, the technical/content checklist, the
opportunity-scoring formula and its unit tests, the routes) is documented
in `platform/docs/epics/04-seo-intelligence-backend.md`.

## 21. Epic 8 (Competitive Intelligence) schema addition

`docs/epics/08-competitive-intelligence.md`'s brief is explicit: this epic
"runs the identical pipeline against competitors instead of the brand" —
Epic 7's `ai_runs`/`ai_run_responses`/`brand_observations` tables, not a
second parallel set. The brief also says to check first whether the ported
schema already anticipated a brand-vs-competitor comparison before adding
anything new.

**It did, but for the wrong pipeline.** The ported schema already has
`competitor_mentions`, `competitor_visibility`, `gap_analysis`, and
`geo_gaps` — all genuinely about comparing a brand to its competitors. Every
one of them, though, keys off the LEGACY pipeline this package's own
`ai_runs` section (§19) already carved a deliberate line around:
`competitor_mentions.analysis_id` → `analyses`, `competitor_visibility.run_id`
→ `prompt_runs`, `gap_analysis`/`geo_gaps` → `intents`/`analyses`. None of
the four has any FK to `ai_runs`. Repurposing them would mean either (a)
writing Epic 8's data into a legacy table a different, untouched pipeline
also writes to (silently coupling two unrelated systems), or (b) adding an
`ai_run_id` FK to a table whose entire other column set was designed around
`analyses`/`prompt_runs`/`intents` semantics that don't apply here. Both are
worse than the alternative: one small, additive column on the table this
epic actually reuses.

**The addition**: `ai_runs.competitor_id String? @db.Uuid`, FK to
`competitors` (`onDelete: Restrict`, same defense-in-depth default as this
table's `query_sets` FK — a competitor is soft-deleted, never hard-deleted,
same as everywhere else in this schema, §5), plus
`idx_ai_runs_competitor` (every FK a route actually filters by gets its own
index, §11's rule). `NULL` is Epic 7's original, completely unmodified case
("this run measures our brand"); non-null means "this run measures one
`competitors` row instead," reusing every other column on the row as-is —
`brand_id` still denormalizes the org's OWN brand (never overwritten with
the competitor's id) because it's what every RLS policy and tenant-scoped
query on this table already filters by; `query_set_id` is unchanged so a
competitor run and the brand's run it gets compared against can (and, for
`GET /brands/me/competitive-gaps`, must) share the identical query set.

**Why no new migration folder.** Every existing `prisma/migrations/000N_*`
folder in this package holds ONLY hand-written SQL Prisma's schema DSL can't
express itself — CHECK constraints, RLS policies, partial indexes (see this
file's own repeated "Prisma's schema.prisma does not have first-class
syntax for..." explanation, §6/§11). A nullable FK column with a plain
`@@index` is fully expressible in `schema.prisma` directly and needs none of
those three things: no CHECK (it's a straightforward FK, not a closed
vocabulary), no new RLS policy (the existing `tenant_isolation` policy on
`ai_runs`, added in 0008, already covers every column on the row, this one
included), no partial index. There is therefore nothing for a `0009_*`
folder to hold — the exact same reasoning the ported schema's own
`queries.source`/`query_sets.plan_tier` base columns already established
(§18: those were added directly in `schema.prisma` with only their later
CHECK constraints getting a dedicated migration folder, 0006).

`apps/api`'s consumption (extending `lib/ai-visibility/pipeline.ts` to
resolve the tracked entity from `run.competitor_id`, the two new routes, the
Competitive Gap / Share of AI Voice / gap-classification math) is documented
in `platform/docs/epics/08-competitive-intelligence-backend.md`.

---

## 22. Epic 17 (Free AI + SEO Growth Snapshot) schema addition

`docs/epics/17-free-snapshot.md`'s API surface adds `GET /snapshot/:token` —
public, unauthenticated, and explicit that the lookup key must NOT be
`snapshot_requests.id` ("don't leak enumerable IDs on a public endpoint").
The ported schema's `snapshot_requests` table (already present, already
correctly left off the RLS list — §12/§1 — as a pre-signup public flow) had
no token column at all: `id` was the only addressable key.

**The addition**: `snapshot_requests.token_hash String @unique @db.VarChar(64)`
— the SHA-256 hex digest of a 32-byte random token, the exact same
"generate once with `lib/tokens.ts`'s `generateOpaqueToken`, store only the
hash, hand the raw value to the caller a single time" pattern already
established for `magic_link_tokens`/`refresh_tokens`/`password_reset_tokens`
(§1's "pure user-scoped security artifacts" list) — not a new pattern
invented for this table. `POST /snapshot` is the only place the raw token
ever exists outside the requester's own browser/inbox; `GET /snapshot/:token`
re-hashes the path param and looks up by `token_hash`, so a leaked database
export is as useless for enumerating live report URLs as it already is for
forging a magic link.

`prisma/migrations/0011_free_snapshot/checks.sql` adds one CHECK
(`token_hash ~ '^[0-9a-f]{64}$'`) — the one piece a plain `@unique` can't
express itself, same "Prisma's schema DSL can't express a regex shape
constraint" reasoning as every other `checks.sql` in this package (§6).

`apps/api`'s consumption (the orchestrator wiring Epics 1/3/4/5/7 together,
the lightweight report shape, the rate-limit/SSRF reuse) is documented in
`platform/docs/epics/17-free-snapshot-backend.md`.

## 22. Epic 9 (Opportunity Engine) schema additions

`docs/epics/09-opportunity-engine.md` is explicitly a MERGE epic: for every
`intent` in the brand's Query Universe (Epic 5's `queries`) that has SEO
demand data (Epic 4's `seo_keywords`/`seo_opportunities`) and/or a GEO gap
classification (Epic 8's `classifyIntentGaps`, computed live off
`ai_runs`/`brand_observations` — no persisted GEO-gap table to read from),
write one merged opportunity row typed `seo`/`geo`/`unified` accordingly,
plus evidence rows citing the specific data behind it. The spec's own domain
model section names the table `opportunities` with a literal field list
(`type`, `intent`, `seo_demand_score`, `geo_gap_score`, `effort_score`,
`impact_score`, `opportunity_score`, `scoring_formula_version`, `status`,
`priority`) and a companion `opportunity_evidence` table.

**The `opportunities` naming collision — resolved the same way §16/§19/§21
resolved theirs, but two levels deep this time.** The ported schema already
has an `opportunities` model (checked before writing this section, per the
recurring "do not guess, read the actual schema.prisma" rule): it keys off
`gap_id -> gap_analysis -> intents/analyses`, the LEGACY pipeline §21 already
carved a line around for `geo_gaps`/`gap_analysis` themselves, and its actual
column set (`unified_score`, `priority_tier`, `action_type`,
`expected_impact`, `keyword_or_query`) does not match this epic's literal
field list at all — not a naming quibble, a different table for a different,
untouched pipeline, left completely alone (same treatment as every other
"old table, new epic" collision in this document). **Epic 4 already hit this
exact situation for the same name** and resolved it by calling its own table
`seo_opportunities` (§20) — which means by the time this epic runs, BOTH the
legacy `opportunities` AND `seo_opportunities` are taken, and neither is this
epic's actual table (Epic 4's is real but deliberately SEO-only; this epic's
output is wider — SEO-only, GEO-only, AND unified rows in one table, per the
spec's own `type` column). Resolution: a third, disambiguated name,
**`unified_opportunities`**, for this epic's actual merge output.
`opportunity_evidence` needed no disambiguation — a grep confirmed the name
was completely unclaimed.

**Merge key: `unified_opportunities.query_id -> queries`, not a text match.**
The epic's own wording ("for each `intent` in the brand's Query Universe")
points straight at Epic 5's `queries` table — each row IS one intent. This is
also what makes idempotent recompute tractable: `@@unique([organization_id,
brand_id, query_id])` gives `POST .../recompute` a real upsert key, so
"re-running updates existing rows in place, never duplicates" (this epic's
explicitly-called-out easy-to-get-wrong DoD requirement) falls out of a
single `findFirst` + create-or-update per query, not a fragile
text-similarity dedupe. `intent_text` (a snapshot of `queries.text`) is
stored alongside so the row and its evidence sentences stay readable even if
the source query is edited later — same "snapshot, don't re-read live"
precedent as `ai_runs.providers`. FK is `Restrict`, not `Cascade`: a query
outlives any one epic's reference to it (`ai_run_responses.query_id`'s
exact precedent, §19).

**Why the join to Epic 4's SEO signal is a text match, and the join to
Epic 8's GEO signal is not.** `seo_keywords` (Epic 4) has no FK to `queries`
(Epic 5) — the two tables were built by different epics with no shared key,
confirmed by reading both epics' actual schema sections rather than assuming
one existed. `apps/api`'s merge logic matches a query's `text` against
`seo_keywords.text` case-insensitively (trimmed, exact match — not fuzzy;
documented as a known v1 limitation, not silently guessed past) to find its
SEO signal. The GEO signal needs no such matching: Epic 8's
`classifyIntentGaps` (`lib/ai-visibility/competitive.ts`) already operates
directly on `queries.id` via `loadCompetitiveDataset`'s `dataset.queries`,
so the merge route reuses that exact function/data path with zero new
join logic — see `platform/docs/epics/09-opportunity-engine-backend.md` for
the full mechanics and the reused-function list.

**Table shapes**, following the standard hardening rules
(`organization_id` + `brand_id` denormalized, RLS FORCEd, indexed):

- **`unified_opportunities`** — `seo_demand_score`/`geo_gap_score` are
  independently nullable (never both non-null unless `type = 'unified'`,
  never a `0` standing in for "no signal" — §1's repeated "a nullable,
  dual-purpose column is where mistakes happen" caution does not apply here
  because neither column is ever the RLS-scoping column, and NULL genuinely
  means "no data," a distinct state from a real zero score). `status` reuses
  the existing `opportunity_status` enum (`new|in_progress|completed|
  dismissed`) — same four-state vocabulary `seo_opportunities.status`
  already reuses from the legacy `opportunities` table (§20's own
  precedent) — rather than a fourth copy of an identical closed vocabulary
  (§6). `priority` is a plain `SmallInt` (1/2/3), validated at the API
  boundary, matching `competitors.priority`/`queries.priority` (§15/§16) —
  not a DB enum, not `priority_tier`'s `P1`/`P2`/`P3` (a differently-scoped
  enum already tied to the legacy `opportunities` table's own semantics).
  `dismissal_reason` (nullable, free text) follows the `deals.lost_reason`
  precedent (§14) for this epic's own explicitly-required "dismiss with a
  reason" flow. `updated_by` is nullable + `SetNull` — status transitions
  are usually a human action (§4's rule, same as `seo_opportunities`), but
  `POST .../recompute` can also revert a `dismissed` row back to `new` when
  the underlying signal materially changes (see the backend doc's
  idempotency section) — that specific transition is system-caused, so
  `updated_by` is left `null` for it rather than lying about a human
  actor.
- **`opportunity_evidence`** — `source_table`/`source_id` stays an open,
  unconstrained pair (no enum, no CHECK) — the exact same "don't invent a
  closed taxonomy for an extensible classification" reasoning §6 and
  `queries.category` (§16) already established, because a future epic
  (content/technical-typed opportunities per the `type` enum's forward-
  reserved values) will cite source tables this epic doesn't know about yet.
  `Cascade` from `unified_opportunities` (true composition child, §5) — an
  evidence row has zero independent meaning once its opportunity is deleted.
  No `deleted_at`/`created_by`/`updated_by` — like `seo_opportunities`'
  own `evidence` JSONB blob, this is pipeline output describing a specific
  computed fact, not human-authored content (§3/§4's "immutable pipeline
  output" rule); unlike that JSONB blob, this epic's spec explicitly calls
  for real linkable rows ("opportunity_evidence rows citing the SPECIFIC
  keyword/AI-response data"), so it is its own table rather than a second
  JSON column.

**`unified_opportunity_type`** — new enum, all five of the spec's literal
values (`seo|geo|unified|content|technical`) added now even though this
epic's own merge logic only ever produces the first three; `content`/
`technical` are forward-reserved for Epic 10 (Recommendation Engine) and
Epic 11 (Content Intelligence), which the spec explicitly names as future
writers of this same table's `type` column — additive now, while the schema
has never been applied to a database, rather than a widening migration
later for a value the domain model already documents.

**RLS** — `prisma/migrations/0010_opportunity_engine/rls.sql` adds the
standard `tenant_isolation` policy to both new tables (both are genuinely
new — no earlier migration's policy could have covered either). **Indexing**
— `prisma/migrations/0010_opportunity_engine/indexes.sql` adds one partial
index, `idx_unified_opportunities_open_score` (`WHERE status != 'dismissed'`)
— the Opportunities screen's default ranked-list read pattern, not
expressible in Prisma's `@@index` DSL (§11's recurring reason). No CHECK
constraints were needed: `unified_opportunity_type`/`opportunity_status` are
native Postgres enums (self-enforcing), and `priority`/the two nullable
score columns follow the established "plain int/nullable decimal, no CHECK"
precedents (§15/§16) rather than inventing a new range constraint no other
epic's equivalent column has either.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption (the merge algorithm, the
scoring-combination formula, the idempotent recompute route, evidence
generation, and the four routes) is documented in
`platform/docs/epics/09-opportunity-engine-backend.md`.

---

## 23. Epic 18 (Agency / White Label / Integrations) schema additions

Three tables this epic needs — `agency_clients`, `integrations`,
`white_label_configs` — already existed (ported from the original schema,
generically hardened in the same pass as everything else: `organization_id`
normalization, RLS, timestamps, `created_by`). Verified directly against
`schema.prisma` and `prisma/migrations/0000_init/{rls.sql,checks.sql}`
before writing anything, per this epic's own "always verify against
schema.prisma directly, never assume a spec's prose name is final"
instruction — the spec's prose ("`organizations.settings` gains a
`whiteLabel` JSONB shape") predates knowledge that a dedicated,
already-RLS'd `white_label_configs` table exists and is a strictly better
fit (typed columns, independently auditable) than a JSONB blob squeezed
into a column three other epics already read/write. `apps/api` reuses it
as-is (no schema change) and exposes it through the spec's literal
`GET/PATCH /orgs/me/settings/white-label` route shape — same "the spec's
literal route survives even when the spec's literal table name doesn't"
precedent Epic 9 established for `unified_opportunities` vs. the legacy
`opportunities` table.

**`agency_clients` — additive columns, not a new table.** This table
already had exactly the shape DECISIONS.md's own §1 called out as the one
genuine two-tenant table (`agency_org_id`, `client_org_id`, its own
special-cased RLS policy scoped to the agency side only — see rls.sql's
"Special case — agency_clients" note, already written before this epic
started). What it did NOT have was any representation of consent: `status`
was a closed `{active,paused,terminated}` business-relationship vocabulary
with no "invited but not yet agreed to" state, so a bare `INSERT` could
already claim `status='active'` unilaterally — exactly what this epic's
brief says must never be possible. Fix: five new nullable columns
(`invited_by`, `consented_by`, `consented_at`, `revoked_by`, `revoked_at`)
and `status`'s vocabulary widens to include `pending` (new default — every
row starts unconsented) and `revoked` (the value the DoD's mandated
"revoking a link immediately blocks a subsequent request" test asserts,
kept distinct from `terminated`'s different, contract-ended business
meaning). The widened CHECK lives in a NEW migration folder
(`0013_agency_white_label_integrations/checks.sql`, `DROP CONSTRAINT IF
EXISTS` + re-`ADD`) rather than editing `0000_init/checks.sql` in place —
same "supersede in a new folder, never rewrite history" precedent
`0006_epic5_postverification_fixes` already set for a different table's
CHECK.

**No fourth "role" column.** The epic spec's own literal table shape lists
`role` as a column, but this table already has `access_level`
(`full|limited|read_only`) encoding the exact same concept for the exact
same table — an agency's granted access tier for one client. Adding a
second column would let the two disagree with each other for no reason
(the same "don't add a column that can disagree with itself" reasoning
DECISIONS.md §17 already applied to `pages.schema_types` vs. a would-be
`has_schema_markup` boolean). `apps/api/src/lib/agency-access.ts` maps
`access_level` onto the platform's real `role` enum
(`full→admin, limited→analyst, read_only→viewer`) at the one place that
turns a link into an authorization decision, so the API-facing contract
still speaks in `role` (matching the spec) while the column stays
`access_level` (matching what was already there).

**`integrations` — two additive timestamp columns.** Already had
`organization_id`, `integration_type` (a closed enum that already includes
`gsc` — Google Search Console, this epic's one real target — alongside
`ga4`/`slack`/`hubspot`/`salesforce`/`zapier`/`webhook`), `config_enc`
(JSONB — the "encrypted at rest" boundary the epic spec asks for; this
build never writes a real OAuth token into it, only a clearly-tagged mock
string, since no real network call is permitted), and `status`
(`connected|disconnected|error`). Missing only `connected_at`/
`disconnected_at` — the epic spec's own literal field names for the
connection lifecycle, distinct from `updated_at` (moves on any edit) and
`last_synced_at` (about data sync, not the connection itself; stays null
through this build — `MockSearchConsoleProvider` never actually syncs
anything). Both added as plain nullable `Timestamptz`, no new enum or
CHECK needed. `seo_provider_source.search_console` (Epic 4) already
anticipated this exact wiring — see that enum's own doc comment in this
file: "`search_console` names the pre-existing, unused `gsc_connections`
OAuth-token table... as the natural first real provider a future epic
would implement." This epic's provider-selection code (documented in
`platform/docs/epics/18-agency-white-label-integrations-backend.md`) reads
this `integrations` table (org-level "is Search Console connected"),
not `gsc_connections` (brand-level real OAuth tokens, still untouched and
still unused — a genuine future OAuth implementation would populate that
table, not this build's mock).

**No RLS changes.** All three tables already had the standard
`tenant_isolation` policy (`agency_clients` already had its two-tenant
special case) from `0000_init/rls.sql`, written before this epic started —
nothing new to add. `0013_agency_white_label_integrations/` therefore
contains only `checks.sql`.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database.

## 24. Epic 10 (Recommendation Engine) schema addition

`docs/epics/10-recommendation-engine.md` generates a **recommendation**
(a specific, actionable brief) from an existing Epic 9 `unified_opportunities`
row's evidence — "opportunities identify WHERE to act; recommendations say
WHAT specifically to do." The spec's own literal domain-model field list:
`opportunity_id`, `title`, `description`, `action_type
(create_page|update_page|fix_technical|build_citations)`, `effort`,
`impact`, `priority_rank`, `evidence_summary`, `implementation_notes`,
`status`, under the table name `recommendations`.

**The `recommendations` naming collision — resolved the same way §22
resolved `opportunities`'.** The ported schema already has a
`recommendations` model (checked directly against schema.prisma before
writing this, per the recurring "do not guess" rule, in the "GAP /
OPPORTUNITY / RECOMMENDATION ENGINE" section): it requires a non-null
`analysis_id` into the LEGACY `analyses` pipeline and keys off the legacy
`opportunities`/`geo_gaps` tables (both already carved off as untouched
legacy pipelines by §21/§22), and its actual column set (`is_recommended`,
`rec_type`, `roi_score`, `rec_status`, optional `opportunity_id`/`gap_id`)
does not match this epic's literal field list at all — a different table
for a different, untouched pipeline, left completely alone. Resolution: a
disambiguated name, **`opportunity_recommendations`**, exactly the "new
epic, `unified_` / `opportunity_`-prefixed table" convention §22 already
established for this same domain.

**One recommendation per opportunity, ever — `@@unique([organization_id,
opportunity_id])`.** This epic's spec explicitly asks for the SAME
idempotency discipline Epic 9's `POST .../recompute` already has ("does
not duplicate on re-run, same discipline as Epic 9"): `POST /opportunities/
:id/recommendations/generate` upserts against this key, so a second
consecutive call updates the existing row's title/description/evidence/
brief fields in place rather than creating a duplicate. `Cascade` from
`unified_opportunities` (not `Restrict`): a recommendation is generated
FROM its opportunity's evidence and, unlike the opportunity itself, has no
independent meaning without it — same true-composition-child reasoning
`opportunity_evidence` already gets (§5/§22).

**`action_type` — a new `recommendation_action_type` enum, not a reuse of
the legacy `action_type` enum** (`content|seo|pr|product|positioning|
technical`, on the legacy `opportunities` table) — checked directly:
that enum's six values share none of this epic's four literal values
(`create_page|update_page|fix_technical|build_citations`), so reusing it
would mean either widening an unrelated legacy enum or silently mapping
onto values that mean something else entirely. `effort`/`impact` both
reuse the existing `effort_level` enum (`low|medium|high`, already used by
the legacy `opportunities.effort_level` column) — per §6's "don't
duplicate a vocabulary that already exists under a generic enough name":
the value SET is identical for both columns, and a Prisma enum's type name
is independent of the column name that uses it, so a second `impact_level`
enum with the exact same three values would be the duplication §6 warns
against, not this reuse. `status` reuses `opportunity_status`
(`new|in_progress|completed|dismissed`) — the same four-state lifecycle
`unified_opportunities.status` itself already reuses from `seo_opportunities`
(§20/§22), since a recommendation's status workflow is functionally
identical, not a fourth copy of one closed vocabulary.

**`priority_rank` is a `Decimal(6,2)` SCORE, not a 1..N list position** —
same shape choice as `unified_opportunities.opportunity_score` (a
recompute-independent, per-row number a caller sorts by), not a
recompute-the-whole-list rank like `priority_tier`. `apps/api`'s exact
formula (`opportunity_score * effort-based multiplier` — see
`platform/docs/epics/10-recommendation-engine-backend.md` and
`lib/recommendations/generator.ts`'s header comment) is a route-layer
concern, not a schema one; the column only needs to be sortable, which a
plain Decimal already is (`GET /brands/me/recommendations` orders
`priority_rank DESC`, same directional convention `opportunity_score`
itself already uses).

**`brand_id` denormalized onto the table** (not read through
`opportunity_id -> unified_opportunities -> brand_id`) — same
"denormalize the tenant/brand key so a list endpoint never needs a join to
scope itself" precedent `unified_opportunities.brand_id` already sets
(§22), needed here for `GET /brands/me/recommendations` to filter/sort
without joining back through the opportunity on every request.

**RLS** — `prisma/migrations/0012_recommendation_engine/rls.sql` adds the
standard `tenant_isolation` policy to the one new table (genuinely new —
no earlier migration's policy could have covered it). **Indexing** —
`prisma/migrations/0012_recommendation_engine/indexes.sql` adds one
partial index, `idx_opportunity_recommendations_open_rank` (`WHERE status
!= 'dismissed'`, ordered by `priority_rank DESC`) — the "top 10
prioritized recommendations" view's exact read pattern
(`docs/09-ux/CUSTOMER_JOURNEY.md`'s onboarding Step 6 / Stage 4 dashboard),
same reasoning `idx_unified_opportunities_open_score` already documents
(not expressible in Prisma's `@@index` DSL — no WHERE clause support). No
CHECK constraints needed: both new enums are native Postgres enums
(self-enforcing), and `priority_rank` follows the established "plain
Decimal, no CHECK" precedent every other opportunity-adjacent score column
already uses.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption (the template-driven
brief generation, the `action_type`/effort/impact/priority_rank derivation,
the idempotent generate route, and the three routes) is documented in
`platform/docs/epics/10-recommendation-engine-backend.md`.

## 25. Epic 11 (Content Intelligence & Generation) schema additions

`docs/epics/11-content-intelligence-generation.md`'s domain model: a content
brief generated FROM an approved, content-type recommendation (§24's
`opportunity_recommendations`), then versioned draft generations against
that brief, each carrying its own stored quality-check results, gated by an
explicit human approval that never itself publishes anything (ADR-007).

**`content_briefs` already existed** (ported in Epic 0 from
`docs/06-database/SCHEMA.md`'s Content section — checked directly against
schema.prisma first, per this epic's own task brief: "check schema.prisma
first, may already have some of this ported"), but had no way to trace back
to the recommendation it came from at all. Added: `recommendation_id`
(required FK -> `opportunity_recommendations`, `Restrict` — a brief is a
durable artifact of its own once drafts/approvals exist under it, so the
source recommendation being later dismissed/completed must never be able to
cascade-delete it), `evidence_summary`/`implementation_notes` (denormalized
COPIES of the recommendation's own fields, snapshotted at brief-creation
time — same "snapshot, don't re-read live" reasoning `ai_runs.providers`
already uses — so a brief keeps saying what it was actually built from even
if the source recommendation is edited/regenerated later; this is what
lets the brief "carry forward the recommendation's dual SEO+GEO
implementation_notes" per this epic's end-to-end flow step 1), and
`research_notes` (JSON — the brand_claims/opportunity_evidence gathered at
generation time, this epic's pipeline step 2, made visible/auditable rather
than silently discarded once the outline is built).
`@@unique([organization_id, recommendation_id])` — one brief per
recommendation, ever, same idempotency discipline every generation step in
this codebase already has (§22's `unified_opportunities`, §24's
`opportunity_recommendations`).

**`content_drafts` is a NEW table, not a retrofit of the pre-existing
`generated_content`.** Checked directly against schema.prisma before
writing this (same "do not guess" rule): `generated_content` was also
already ported in Epic 0 under the Content Intelligence section, but its
column set has no `version` or `prompt_version` at all — this epic's DoD
literally tests "regenerating creates version 2, version 1 remains
readable, never overwritten," which needs the same schema surgery either
way. Two further reasons NOT to retrofit it: (1) `generated_content.status`'s
existing vocabulary is `draft|approved|published|rejected` — a `'published'`
value in this epic's own draft-status vocabulary is precisely the ADR-007
line this epic's DoD requires be structurally absent, not just avoided by
convention; `content_drafts.status` only ever reaches `generated|approved`
(enforced by `chk_content_drafts_status`). (2) A concurrent epic may still
want `generated_content`'s current shape for a different purpose (most
likely Epic 12's agent-generated output, given `geo_agent_actions`/
`seo_agent_actions` already reference `content_briefs` directly). Same
"a different, wrong-shaped table for a different concern, left completely
alone" resolution §22/§24 already use for the legacy `opportunities`/
`recommendations` tables — `generated_content` (and `publish_jobs`, see
below) are untouched by this epic. `@@unique([brief_id, version])` is both
the version-ordering guarantee and the collision guard for `POST
/content-briefs/:id/draft` always inserting the next version rather than
computing one racily.

**`content_quality_checks`** — one row per `(draft_id, check_type)` per
generation, for this epic's explicit DoD requirement that every quality
check's OWN result be stored, "not just a pass/fail flag... a reviewer
approving a draft needs to see what was checked, not just that something
was." `check_type` is CHECK-constrained to the spec's literal 5-check list
(`fact_check`, `brand_voice`, `duplicate_content`, `seo_checklist`,
`geo_structure`); `details` (JSON) holds each check's own evidence (which
brand_claims were checked, which crawled page collided, which GEO
structuring signals were found), never discarded once a `pass|fail|warning`
status is derived from it. Cascade from `content_drafts` — a check result
has zero independent meaning once its draft is gone, same composition-child
reasoning as `opportunity_evidence` (§5/§22).

**`content_approvals` is a NEW, dedicated table — deliberately NOT the
pre-existing `publish_jobs`.** `publish_jobs` (also already ported in Epic 0,
for Epic 13's later publishing workflow) already has `approved_by`/
`approved_at`/`rejection_reason` columns that look approval-shaped, but they
sit alongside `destination`/`destination_config`/`published_at`/
`published_url`/`publish_log` — the act of publishing itself. This epic's
DoD requires the publish boundary be enforced "by absence of any publish
call, not by convention": writing this epic's approval into a table
literally named `publish_jobs`, even never touching its publish-shaped
columns, blurs exactly the line the DoD asks be structurally clear.
`content_approvals` has no destination/published/schedule concept anywhere
in it — `@unique` on `draft_id` (one approval per draft VERSION, ever, per
this epic's literal domain-model bullet: "who approved, when, at what draft
version"), `approved_role` snapshotted at approval time (an org changing a
member's role later must never retroactively rewrite what role actually
authorized a past approval — same snapshot reasoning `content_briefs.
evidence_summary` above uses). `publish_jobs` is left completely untouched;
Epic 13 owns it.

**RLS** — `prisma/migrations/0015_content_intelligence_generation/rls.sql`
adds the standard `tenant_isolation` policy to the three genuinely new
tables (`content_briefs` already has one from 0000_init). **CHECK
constraints** — `.../checks.sql` adds `content_drafts.status` and
`content_quality_checks.check_type`/`.status`.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption (brief generation from an
approved recommendation, mocked-provider draft generation via
`AIProviderRegistry`, the five quality checks, and the approve endpoint) is
documented in
`platform/docs/epics/11-content-intelligence-generation-backend.md`.

## 26. Epic 12 (GEO Agent / SEO Agent / Growth Agent) schema additions

`docs/epics/12-agents.md`'s domain model calls for `agent_runs`/
`agent_events` — genuinely new tables. Checked directly against
schema.prisma first, per this epic's own "always verify against
schema.prisma directly" instruction: the ported schema already has
`geo_agent_runs`/`seo_agent_runs`/`growth_agent_runs`/`geo_agent_actions`/
`seo_agent_actions` (three separate per-agent-type run tables, keyed into
the legacy `geo_gaps`/legacy `opportunities`/legacy `keywords`/
`content_briefs` pipeline, with no event log, no autonomy level, and no
approval/rollback mechanics), but the bare names `agent_runs`/
`agent_events` themselves were confirmed UNCLAIMED — unlike
`opportunities`/`recommendations`/`ai_responses`, no disambiguating prefix
was needed here. All five legacy tables are left completely untouched, same
treatment every other "old table, new epic" collision in this document
gets.

**Three new tables**, all following the standard hardening rules
(`organization_id` + `brand_id` denormalized, RLS FORCEd, indexed):
`agent_runs` (`agent_name`/`status`/`triggered_by` as VARCHAR+CHECK, same
"closed but may grow" reasoning `crawl_jobs.status` already uses;
`autonomy_level SmallInt` CHECK `IN (1, 2, 3)` — **never 4**, defense in
depth on top of the application-level hard block in
`apps/api/src/lib/agents/autonomy.ts`; `triggered_by_id` required only when
`triggered_by = 'user'`, CHECK-enforced, same "required attribution when a
human causes it" pattern `crawl_jobs.created_by`/`ai_runs.created_by` use
via NOT NULL, expressed as a CHECK here because the column must stay
nullable for the other two trigger kinds); `agent_events` (genuinely
append-only — no `created_by`/`updated_by`/`deleted_at`, this IS the
literal mechanism behind AGENT_ARCHITECTURE.md's "customers can see what
the agent did, step-by-step" transparency requirement, not just a
convention); `agent_pending_actions` (Level 3 mechanics — `status`/
`approved_by`/`approved_at`/`rollback_until` CHECK-enforced to only ever be
populated together, never partially; `rollback_until` is a real, queryable
30-day deadline this epic only ever WRITES, Epic 13's job to read).

**RLS** — `prisma/migrations/0014_agents/rls.sql` adds the standard
`tenant_isolation` policy to all three (genuinely new, no earlier
migration's policy could have covered any of them). **CHECK constraints**
— `.../checks.sql`: `agent_name`/`status`/`triggered_by` vocabularies,
the `triggered_by_id`-required-for-`user` invariant, `autonomy_level IN (1,
2, 3)`, `agent_events.type`, `agent_pending_actions.status`, and the
approval-fields-all-or-nothing invariant. **Indexing** — `.../indexes.sql`
adds one partial index, `idx_agent_pending_actions_pending` (`WHERE status
= 'pending'`), the approval-queue read pattern, not expressible in Prisma's
`@@index` DSL (§11's recurring reason).

**Migration numbering collision, flagged rather than silently
resolved.** This folder (`0014_agents`) and Epic 11's own
`0015_content_intelligence_generation` (see §25) were both created as
`0014_*` within the same build wave — checked by file timestamp, this
folder was written first (08:34 vs. 08:36 in this run's local clock).
Following the exact renumbering precedent this document already
establishes twice (§14's CRM `0001`→`0002`, §17's Website Intelligence
`0004`→`0005` — in both cases the SECOND-landed folder renumbers, not the
first), this folder correctly keeps `0014`. It was deliberately NOT
possible to renumber Epic 11's folder from here without risking a
collision with that epic's own concurrent, in-progress edits to its files
and to this same document — flagged here instead so whoever runs the first
real `prisma migrate deploy` (or a later audit pass) renumbers
`0015_content_intelligence_generation` to `0015_content_intelligence_
generation` before applying both, exactly as the two prior collisions in
this document were resolved. Neither folder is a real Prisma-generated
migration (hand-written SQL only, same as every other folder in this
package), so nothing is functionally broken by the collision existing
transiently in the repo — only the eventual apply order needs the rename.

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption (three thin-orchestrator
agents, the autonomy-level hard block, the tool-permission allowlist, the
runner, and the four routes) is documented in
`platform/docs/epics/12-agents-backend.md`.

## 27. Epic 13 (Action Center & Controlled Publishing) schema additions

`docs/epics/13-action-center-publishing.md`'s domain model is the
approve -> execute -> rollback lifecycle `docs/06-database/SCHEMA.md` §4's
literal `actions` DDL specifies (`recommendation_id`/`autonomy_level`/
`approved_by`/`approved_at`/`executed_at`/`rolled_back_at`/`result`), plus a
`published_content` table (listed by name in SCHEMA.md's Content schema
group outline, §8, but never actually given a DDL body anywhere in that
document).

**`actions` already existed** (ported in Epic 0), checked directly against
schema.prisma first (this epic's own "check the schema first" instruction) —
but as a generic, unconsumed "action item" shape (`priority`/`source`/
`source_id`/`assigned_to`/`due_date`/`metadata`, `status` IN `{pending,
in_progress, completed, dismissed}`) with **zero application code touching
it anywhere**, confirmed by grep before this epic's first edit. This is the
same situation §25 already resolved for `content_briefs`' missing
`recommendation_id`: extend the already-ported table rather than rename/
duplicate it. Every pre-existing column is kept (harmless, orthogonal, zero
migration risk since no row/caller exists yet); this epic adds exactly the
domain-model columns it needs (`recommendation_id`, `autonomy_level`,
`approved_by`/`approved_at`, `executed_at`, `rolled_back_at`, `result`) plus
two handoff FKs not in SCHEMA.md's own DDL but required by this epic's own
task brief: `content_draft_id` (Epic 11 -> Epic 13) and
`agent_pending_action_id` (Epic 12 -> Epic 13), both `@unique` (idempotent —
a given draft/pending-action spawns at most one `actions` row, ever) and
mutually exclusive (`chk_actions_single_handoff_source`) — a real FK,
never a re-typed copy of the source row's own fields, per this epic's
explicit instruction. `status`'s vocabulary is widened to this epic's real
lifecycle (`pending -> approved -> completed`, or `rolled_back`) — safe for
the same "zero existing rows/callers" reason as the rest of this extension.

**`autonomy_level` deliberately stays 1-4 at the DB layer** — unlike
`agent_runs.autonomy_level` (§26's `chk_agent_runs_autonomy_level`, CHECK
`IN (1,2,3)`, which makes a Level 4 row physically impossible to create).
This epic's own non-negotiable is different in kind: "No code path exists
that publishes without a prior `approved_at`... enforceable by reading the
execute function's guard clause itself" and "Autonomy Level 4 must be
rejected by the execute path even given a manually-crafted request with
approval fields set." Both phrasings assume a row CAN legitimately hold
`autonomy_level: 4` (a manually-crafted/corrupted row, or simply data this
epic's own creation code never produces but does not itself forbid) and
require the EXECUTE function's own guard clause to be what catches it — not
a CHECK constraint quietly making the scenario untestable by construction.
Two DB-level constraints still back that application guard up as genuine
defense-in-depth (`chk_actions_execute_requires_approval`,
`chk_actions_level4_never_executes`) — belt AND suspenders, same
"the constraint is backup, not the primary mechanism" relationship §26's own
`chk_agent_runs_autonomy_level` comment already documents for its table.

**`published_content` is a NEW table, deliberately NOT a reuse of the
pre-existing `publish_jobs`** (also already ported in Epic 0 — §25 already
flagged it as "ported... for Epic 13's later publishing workflow"). Checked
directly against schema.prisma and against `publish_jobs`'s actual column
set before deciding this: `publish_jobs` bundles `destination`/
`destination_config` (JSON — third-party CMS connection config),
`scheduled_at`, `rejection_reason`, and `publish_log` (JSON — step-by-step
publish log) alongside its `approved_by`/`approved_at`/`published_at`/
`published_url` fields — the shape of a genuine, multi-destination external
publish workflow this epic explicitly does NOT build ("actually pushing to
a customer's external CMS is explicitly out of scope for this build... a
`PublishTarget` interface with an internal-record-only default
implementation," this epic's own spec, verbatim). Writing this epic's
publish record into `publish_jobs` would leave `destination_config`/
`scheduled_at`/`rejection_reason`/`publish_log` permanently unpopulated
dead columns implying a workflow that does not exist yet — the exact same
"a different, wrong-shaped table for a different, not-yet-built concern,
left alone rather than reused" reasoning §25 already used to justify
`content_approvals` NOT reusing `publish_jobs`, and §25/§22 use for
`content_drafts`/`opportunities` vs. their own legacy near-namesakes.
`published_content` has no destination-config/schedule/rejection concept
anywhere in it: `action_id` (`@unique` — one publish record per action,
ever), `publish_target` (the real `PublishTarget.name` that wrote the row),
`destination_ref` (an internal locator, e.g. `internal://published-content/
<actionId>` — never a real external URL), `title`/`body` (a snapshot of the
published `content_drafts` row, when the action came from one),
`published_by`/`published_at`, `rolled_back_by`/`rolled_back_at`, and
`result` (the raw `PublishTarget` result payload). `publish_jobs` is left
completely untouched by this epic, still available for whichever future
epic actually builds a real, multi-destination CMS integration.

**`PublishTarget`** (`apps/api/src/lib/actions/publish-target.ts`) is
transcribed in the exact same shape/factory-function precedent
`lib/billing/payment-provider.ts` (Epic 16) already established for
`PaymentProvider`/`NullPaymentProvider` — a single interface, one shipped
`NullPublishTarget` implementation (deterministic, zero network calls, an
internal-record-only `destinationRef`), a process-lifetime singleton getter
(`getPublishTarget()`), and a test-only setter
(`__setPublishTargetForTesting`). No registry class, same "exactly one real
implementation, no routing table to encode yet" reasoning
`payment-provider.ts`'s own header comment gives.

**RLS** — `prisma/migrations/0016_action_center_publishing/rls.sql` adds
the standard `tenant_isolation` policy to `published_content` (the one
genuinely new table; `actions` already has RLS from 0000_init). **CHECK
constraints** — `.../checks.sql`: `actions.status` (widened, DROP + re-ADD,
same precedent §23/0013's `chk_agency_clients_status` widening already
established), `actions.autonomy_level` (1-4), the two execute-guard mirror
constraints, the approval-fields-together and single-handoff-source
invariants, and `published_content.status`/rollback-fields-together.

**30-day rollback window — resolved ambiguity.** Neither SCHEMA.md nor
AGENT_ARCHITECTURE.md's "Rollback available for 30 days" states which
timestamp the window is measured FROM. This epic's own task brief names
both candidates ("compare against `approved_at` or `executed_at` per the
spec"). Resolved as `executed_at` + 30 days
(`apps/api/src/lib/actions/rollback-window.ts`): rollback reverts
`published_content` — the artifact created AT execution, not at approval —
and `approved_at`/`executed_at` can legitimately drift apart (spec's own
step 2: "a human might approve now and the system executes async"),
so measuring from `approved_at` could silently shrink the window below the
full 30 days customers were promised, which is the more customer-hostile
failure mode of the two readings. No `rollback_until` column is persisted
on `actions` (unlike `agent_pending_actions.rollback_until`, §26) — the
deadline is a pure function of `executed_at` + a constant, computed at
request time, not a second column that could drift from the timestamp it is
derived from (same "don't add a column that can disagree with itself"
reasoning this document already applies elsewhere, e.g. `brands`' own
header comment on `account_health`).

**Handoff wiring — the two insertion points, found by reading each source
epic's actual code, not re-guessed from the spec's prose:**
- Epic 11 -> Epic 13: `routes/content-drafts.ts`'s `POST
  /content-drafts/:id/approve` (that file's own header comment already
  anticipated this: "Epic 13 is the only future code that ever moves a
  draft past this point, and it does so through its OWN table, never by
  mutating this one further") — right after `content_drafts.status` flips
  to `'approved'`, a pending `actions` row is created with
  `content_draft_id` set to the real draft id and `recommendation_id`
  denormalized from the draft's own brief. This relies on the route's
  EXISTING idempotency short-circuit (a second approve on an
  already-approved draft returns before reaching this new code at all) for
  its own idempotency, backed up by `content_draft_id`'s DB-level
  `@unique` as a second line of defense.
- Epic 12 -> Epic 13: `routes/agent-run-details.ts`'s `POST
  /agent-runs/:id/approve`. This epic's own spec line ("a Level-3-approved
  agent action... becomes an actions row, status: pending") is read as: the
  SAME event this route already performs (`agent_pending_actions.status`
  flipping to `'approved'`, a real human decision) is what "Level-3-approved"
  names — so the insertion point is right after that update, not
  `runner.ts`'s earlier (pre-approval) pending-action creation. This DOES
  add a new mutation to a route Epic 12's own test suite asserted performs
  no other table's create/update (`agent-run-details.test.ts`'s "never
  publishes/executes anything" case) — that assertion's own wording is
  literally about publish/execute (still true: this insertion only ever
  creates a `pending` Action Center entry, the same bookkeeping shape the
  content-drafts handoff performs, never anything publish-shaped), so the
  test was updated (not weakened) to assert the new `actions.create` call's
  exact shape alongside the still-true "no publish/content-draft/execute
  call" invariant. Neither handoff's `actions.create` call is itself
  audit-logged: the privileged decision it follows (`content.approved` /
  `agent.action`) is already logged by the pre-existing code immediately
  above it, and a second log entry for the same human decision would be
  redundant, not a missing event — `actions.approved`/`.executed`/
  `.rolled_back` are their own privileged decisions, logged by this epic's
  own three routes instead.

**`GET /brands/:id/actions`** — the spec's literal route. Adapted to `GET
/brands/me/actions`, the single-brand-per-org convention every Epic 2+
route in `app.ts` already uses (documented per-route in that file, e.g.
Epic 12's own `/brands/:id/agents/:agentName/run` -> `/brands/me/...`
adaptation) — not a fresh decision, applying an established precedent.

**RBAC** — `POST /actions/:id/approve`/`/execute`/`/rollback` all gate on
`publish_content` (owner/admin only), not `approve_content`
(owner/admin/editor-own, Epic 11's OWN draft-quality gate). This epic's own
task brief is explicit that its approval is "per docs/08-security/
SECURITY.md's 'Publish content: owner/admin only'" — a materially different,
stricter permission than "Approve content," and SECURITY.md's matrix has
exactly one row for the whole publish-shaped decision, covering approve,
the execute that follows it, and the rollback that reverses it alike (`lib/
rbac.ts`'s `Action` union already had `publish_content` defined, unused by
any route until this epic — anticipated, same as `approve_content`/
`create_content_draft` were for Epic 11, per that file's own header
comment).

As with every other section: `prisma validate`/`generate` only — nothing
applied to a database. `apps/api`'s consumption (the `PublishTarget`
abstraction, the three lifecycle routes with their guard clauses, and the
two cross-epic handoffs) is documented in
`platform/docs/epics/13-action-center-publishing-backend.md`.
