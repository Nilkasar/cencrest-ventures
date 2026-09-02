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
