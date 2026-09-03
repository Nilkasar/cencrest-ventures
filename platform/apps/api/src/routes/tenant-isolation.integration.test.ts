/**
 * Tenant isolation is a hard quality gate (docs/19-testing/TESTING_STRATEGY.md:
 * "This test category is a hard quality gate — no epic is COMPLETE without
 * it passing for all new entities"). It cannot be meaningfully verified
 * with a mocked Prisma client — the entire point is to prove that
 * PostgreSQL's Row-Level Security policies (prisma/migrations/0000_init/
 * rls.sql in @bebest/database) actually reject cross-tenant access, which
 * requires a real Postgres instance with those policies applied.
 *
 * NEEDS LIVE DB. This file is intentionally not skipped silently — it is
 * present and documents exactly what must be proven, but every test is
 * `.skip`ped with a NEEDS LIVE DB marker so `vitest run` stays green
 * without a database while making the gap impossible to miss. Un-skip and
 * fill in the bodies once there is a disposable Postgres instance to run
 * migrations + rls.sql + checks.sql + indexes.sql against (see
 * apps/api/README.md's "Running against a real database" section).
 *
 * Required scenarios (docs/08-security/SECURITY.md's "Testing Tenant
 * Isolation" + TESTING_STRATEGY.md's "Tenant Isolation Tests" list):
 *   1. User in Org A cannot READ Org B's data (any tenant table).
 *   2. User in Org A cannot WRITE to Org B's data (INSERT with a foreign
 *      org's organization_id must violate the WITH CHECK clause).
 *   3. User in Org A cannot DELETE Org B's data.
 *   4. A background job / system-role connection for Org A cannot access
 *      Org B's data UNLESS it is explicitly running as the bypass-RLS
 *      admin role (which must itself be a deliberate, audited code path,
 *      not the default).
 *   5. `memberships` — a user's own membership rows across MULTIPLE orgs
 *      are all visible via `withUserContext` (the org-switcher case), but
 *      another user's membership rows are never visible.
 *   6. `organization_rate_limits` — confirm it is genuinely NOT protected
 *      by RLS (by design, see @bebest/database DECISIONS.md §7a) so this
 *      doesn't regress into an accidental gap for an actually-sensitive
 *      table if someone copies this table's pattern elsewhere later.
 */

import { describe, it } from 'vitest';

describe.skip('tenant isolation (NEEDS LIVE DB)', () => {
  it.todo('a user in Org A gets zero rows querying a tenant table scoped to Org B');

  it.todo(
    'inserting a row with organization_id set to a foreign org is rejected by WITH CHECK',
  );

  it.todo('a user in Org A cannot delete a row that belongs to Org B');

  it.todo(
    'withOrgContext(orgA, ...) never returns rows for orgB even for a table reachable ' +
      'through a denormalized organization_id column two joins deep (e.g. `citations`)',
  );

  it.todo(
    'memberships: withUserContext(userId, ...) returns ALL of that user\'s orgs, not just one',
  );

  it.todo("memberships: withUserContext(userId, ...) never returns another user's rows");

  it.todo(
    'organization_rate_limits: a query with no app.current_org set can still read/write its ' +
      'own bucket row (confirms the intentional RLS exemption actually behaves as designed)',
  );

  it.todo(
    'FORCE ROW LEVEL SECURITY actually applies to the bebest_app role, not just non-owner ' +
      'roles — i.e. bebest_app must NOT be the table owner in whatever environment this runs against',
  );
});

/**
 * Epic 1 (CRM) — `leads`, `deals`, `activities`. Same NEEDS LIVE DB
 * constraint as above, plus the one thing genuinely specific to this
 * epic's schema design (see @bebest/database schema.prisma's "Epic 1 (CRM)
 * additions" comment and DECISIONS.md's "Epic 1 — CRM" section): all three
 * tables' `organization_id` (the RLS-scoping column) is NOT NULL and always
 * resolves to the fixed internal BeBest operations org — there is no
 * "cross-tenant" scenario between two CUSTOMER orgs to test for these
 * tables the way there is for `brands`/`competitors`/etc., because these
 * rows never belong to a customer org in the first place. What actually
 * needs proving instead is that the ONE tenant boundary that exists here
 * (internal-org staff vs. everyone else) holds, and that the business-link
 * columns (`converted_organization_id` / `account_organization_id`), which
 * carry no RLS policy of their own, cannot be used to smuggle read access
 * across it.
 */
describe.skip('CRM tenant isolation — leads/deals/activities (NEEDS LIVE DB)', () => {
  it.todo(
    'a user who is NOT a member of the internal BeBest operations org gets zero rows from ' +
      'leads/deals/activities, even via withOrgContext(theirOwnOrgId, ...) — i.e. a customer\'s ' +
      'own org membership grants no visibility into CRM tables no matter what role they hold',
  );

  it.todo(
    'inserting a leads/deals/activities row with organization_id set to anything other than ' +
      'the internal org id is rejected by WITH CHECK, even by an internal-org member (proves ' +
      'the internal-org-only scoping is enforced at the database level, not just by ' +
      'apps/api/src/lib/internal-org.ts always supplying the right id)',
  );

  it.todo(
    'converting a lead (creating/linking an organization + setting ' +
      'converted_organization_id) does NOT change the row\'s organization_id — the row stays ' +
      'visible under withOrgContext(internalOrgId, ...) and invisible under ' +
      'withOrgContext(theConvertedCustomerOrgId, ...), confirming converted_organization_id/' +
      'account_organization_id are pure data columns with no RLS role of their own',
  );

  it.todo(
    'the chk_activities_target_present CHECK constraint rejects an activities row with ' +
      'lead_id, deal_id, AND account_organization_id all NULL',
  );

  it.todo(
    'the chk_deals_value_cents_non_negative and chk_deals_probability_range CHECK constraints ' +
      'reject out-of-range values',
  );
});

/**
 * Epic 2 (Brand Intelligence) — `brands`, `competitors`, `brand_entities`,
 * `use_cases`, `brand_claims`. Same NEEDS LIVE DB constraint as every block
 * above. Unlike CRM, these five ARE ordinary customer-tenant tables (every
 * row's `organization_id` is a real customer org, not a fixed internal
 * one) — the generic scenarios in the first `describe.skip` above already
 * cover them structurally, but a qa-flow-tester pass asked for these named
 * per-table instead of left as generic coverage, so the DoD checklist has a
 * concrete, nameable item per table. Each block also covers the one thing
 * genuinely specific to that table's route design (see
 * `apps/api/src/lib/brand-context.ts` and `lib/entitlements.ts`).
 */
describe.skip('Epic 2 tenant isolation — brands (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets a 404 (not Org B\'s brand) from GET /brands/me — getBrandForOrg\'s ' +
      'findFirst is scoped by organization_id, not just "the first brand row in the table"',
  );

  it.todo(
    'withOrgContext(orgA, ...) never returns Org B\'s brand even when both orgs have exactly ' +
      'one brand row each (the common case, since this epic assumes one brand per org)',
  );

  it.todo(
    'inserting/updating a brands row with organization_id set to a foreign org is rejected by ' +
      'WITH CHECK, even via PATCH /brands/me\'s upsert path (create-or-update must not let a ' +
      'caller attach their write to another org\'s row)',
  );
});

describe.skip('Epic 2 tenant isolation — competitors (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/competitors for Org B\'s competitors, ' +
      'even when both orgs are on the same plan tier with the same competitor count',
  );

  it.todo(
    'inserting a competitors row with organization_id set to a foreign org is rejected by ' +
      'WITH CHECK',
  );

  it.todo(
    'checkUsageLimit(\'competitors_tracked\') for Org A counts ONLY Org A\'s non-deleted ' +
      'competitors — Org B being at or over its own plan limit must never affect Org A\'s ' +
      'entitlement check (proves the count query in routes/competitors.ts is tenant-scoped, ' +
      'not just brand-scoped)',
  );

  it.todo(
    'a user in Org A cannot PATCH or DELETE a competitor row that belongs to Org B, even when ' +
      'given Org B\'s competitor id directly (id-guessing must still 404, not leak or mutate)',
  );
});

describe.skip('Epic 2 tenant isolation — brand_entities (NEEDS LIVE DB)', () => {
  it.todo('a user in Org A gets zero rows from GET /brands/me/entities for Org B\'s entities');

  it.todo(
    'inserting a brand_entities row with organization_id set to a foreign org is rejected by ' +
      'WITH CHECK',
  );

  it.todo(
    'a user in Org A cannot PATCH or DELETE a brand_entities row that belongs to Org B via its id',
  );
});

describe.skip('Epic 2 tenant isolation — use_cases (NEEDS LIVE DB)', () => {
  it.todo('a user in Org A gets zero rows from GET /brands/me/use-cases for Org B\'s use cases');

  it.todo(
    'inserting a use_cases row with organization_id set to a foreign org is rejected by WITH CHECK',
  );

  it.todo(
    'a user in Org A cannot PATCH or DELETE a use_cases row that belongs to Org B via its id',
  );
});

describe.skip('Epic 2 tenant isolation — brand_claims (NEEDS LIVE DB)', () => {
  it.todo('a user in Org A gets zero rows from GET /brands/me/claims for Org B\'s brand claims');

  it.todo(
    'inserting a brand_claims row with organization_id set to a foreign org is rejected by ' +
      'WITH CHECK',
  );

  it.todo(
    'a user in Org A cannot PATCH or DELETE a brand_claims row that belongs to Org B via its id',
  );
});

/**
 * Epic 5 (Intent & Query Universe) — `query_sets`, `queries`. Same
 * NEEDS LIVE DB constraint as every block above. `queries` is the one new
 * RLS policy this epic adds (`query_sets` already had one from 0000_init —
 * see @bebest/database prisma/migrations/0004_query_universe/rls.sql and
 * DECISIONS.md); both tables' tenant boundary is otherwise the same
 * `organization_id = app.current_org` template as every other table here,
 * per docs/epics/05-intent-query-universe.md's "End-to-end flow" step 6.
 */
describe.skip('Epic 5 tenant isolation — query_sets / queries (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/query-sets for Org B\'s query sets, ' +
      'even when both orgs generated a set from an identical brand profile',
  );

  it.todo(
    'inserting a query_sets or queries row with organization_id set to a foreign org is ' +
      'rejected by WITH CHECK (covers POST /query-sets/generate\'s query_sets.create with a ' +
      'nested queries.create, and the standalone POST /:id/queries manual-add path)',
  );

  it.todo(
    'a user in Org A cannot GET/PATCH/DELETE a query_sets or queries row that belongs to Org ' +
      'B via its id, even when given the id directly (id-guessing must 404, not leak, activate, ' +
      'or mutate another org\'s query universe)',
  );

  it.todo(
    'checkUsageLimit-style capping in POST /query-sets/generate — resolvePlanLimits(orgA) reads ' +
      'ONLY Org A\'s subscription; Org B being on a different plan tier must never change the ' +
      'cap applied to Org A\'s generated query set',
  );
});

/**
 * Epic 3 (Website Intelligence) — `crawl_jobs`, `pages`, `page_issues`,
 * `sitemaps`. Same NEEDS LIVE DB constraint as every block above. All four
 * tables use the same `organization_id = app.current_org` template as
 * every other table here (`crawl_jobs`/`pages`/`page_issues` already had
 * their RLS policy from 0000_init; `sitemaps` is the one new policy this
 * epic adds — see @bebest/database prisma/migrations/0005_website_
 * intelligence/rls.sql and DECISIONS.md's Epic 3 section), so there is no
 * bespoke policy shape to prove here the way CRM's fixed-internal-org
 * design or memberships' dual-clause policy needed. What IS specific to
 * this epic, and worth its own named coverage per
 * docs/epics/03-website-intelligence.md's end-to-end flow step 6, is that
 * `pages`/`page_issues` are two tables away from `organizations` in the
 * schema (via `crawl_jobs`/`brands`) yet carry their OWN denormalized
 * `organization_id` — exactly the "reachable through a join two levels
 * deep" case the generic top-level block's `citations` example already
 * names, called out again here so it's an explicit, nameable item for
 * this epic's own DoD checklist rather than only implied coverage.
 */
describe.skip('Epic 3 tenant isolation — crawl_jobs / pages / page_issues / sitemaps (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /crawl-jobs/:id for a job id that belongs to Org ' +
      'B, even when given the id directly (routes/crawl-jobs.ts\'s findFirst is scoped by ' +
      'organization_id, not id alone)',
  );

  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/pages for Org B\'s pages, even when ' +
      'both orgs crawled the exact same public URL (raw_html_hash colliding across tenants ' +
      'must never cause a cross-tenant read)',
  );

  it.todo(
    'inserting a crawl_jobs, pages, page_issues, or sitemaps row with organization_id set to a ' +
      'foreign org is rejected by WITH CHECK — covers POST /brands/me/crawl\'s crawl_jobs.create ' +
      'and every write the background crawl engine (lib/crawler/engine.ts) makes for that job',
  );

  it.todo(
    'withOrgContext(orgA, ...) never returns Org B\'s pages/page_issues rows even though both ' +
      'are reachable only via a JOIN through crawl_jobs -> brands -> organizations, not a direct ' +
      'organizations FK — the denormalized organization_id column on pages/page_issues is what ' +
      'RLS actually filters on, and this proves it, not the join path',
  );

  it.todo(
    'POST /brands/me/crawl\'s "already queued or running" 409 check (existingActive lookup) is ' +
      'scoped to Org A\'s own crawl_jobs only — Org B having a running crawl for an unrelated ' +
      'brand must never block or be visible to Org A\'s trigger attempt',
  );
});

/**
 * Epic 4 (SEO Intelligence) — `keyword_groups`, `seo_keywords`,
 * `seo_analyses`, `seo_opportunities`. Same NEEDS LIVE DB constraint as
 * every block above. All four tables are genuinely new (see
 * @bebest/database prisma/migrations/0007_seo_intelligence/rls.sql and
 * DECISIONS.md's Epic 4 section) — each gets its own fresh
 * `tenant_isolation` policy rather than inheriting one from an earlier
 * migration, so there is no "which of these already had RLS" nuance the way
 * Epic 3's block above has for `crawl_jobs`/`pages`/`page_issues`.
 */
describe.skip('Epic 4 tenant isolation — keyword_groups / seo_keywords / seo_analyses / seo_opportunities (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/seo/keyword-groups for Org B\'s keyword ' +
      'groups, even when both orgs generated a group from an identical brand profile',
  );

  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/seo/keyword-groups/:id/keywords for a ' +
      'group id that belongs to Org B, even when given the id directly (getKeywordGroup\'s ' +
      'findFirst is scoped by organization_id AND brand_id, not id alone)',
  );

  it.todo(
    'inserting a keyword_groups, seo_keywords, seo_analyses, or seo_opportunities row with ' +
      'organization_id set to a foreign org is rejected by WITH CHECK — covers POST ' +
      '/seo/keyword-groups/generate\'s nested keyword_groups.create + seo_keywords.createMany + ' +
      'seo_opportunities.create writes, and POST /seo/analyze\'s seo_analyses.create writes',
  );

  it.todo(
    'withOrgContext(orgA, ...) never returns Org B\'s seo_analyses rows even for a brand-level ' +
      'row with page_id NULL (analysis_type = \'content\') — the denormalized organization_id ' +
      'column is what RLS filters on, not a join through a specific page',
  );

  it.todo(
    'GET /brands/me/seo/opportunities for Org A never returns an opportunity scored from Org ' +
      'B\'s keyword data, even when both orgs\' generated keyword lists happen to contain the ' +
      'exact same keyword text (seo_keywords has no cross-org uniqueness — text collisions across ' +
      'tenants must never cause a cross-tenant read via keyword_id)',
  );

  it.todo(
    'a user in Org A cannot PATCH (rename), DELETE, or dismiss a keyword_groups, seo_keywords, ' +
      'or seo_opportunities row that belongs to Org B via its id, even when given the id directly',
  );
});

/**
 * Epic 7 (AI Visibility Engine / GEO core) — `ai_runs`, `ai_run_responses`,
 * `brand_observations`. Same NEEDS LIVE DB constraint as every block above.
 * All three tables are genuinely new (see @bebest/database
 * prisma/migrations/0008_ai_visibility_engine/rls.sql and DECISIONS.md's
 * Epic 7 section) — each gets its own fresh `tenant_isolation` policy, same
 * as Epic 4's block above, so there is no "which of these already had RLS"
 * nuance to prove. What IS specific to this epic, per
 * docs/epics/07-ai-visibility-engine.md's end-to-end flow step 7, is that
 * the background pipeline (`lib/ai-visibility/pipeline.ts`) — not a route
 * handler — is what makes most of the writes here (every `ai_run_responses`
 * and `brand_observations` row), so the WITH CHECK proof below needs to
 * exercise that path, not just the route's own `ai_runs.create`.
 */
describe.skip('Epic 7 tenant isolation — ai_runs / ai_run_responses / brand_observations (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/ai-runs for Org B\'s runs, even when both ' +
      'orgs ran an identical query_set against an identical brand profile',
  );

  it.todo(
    'a user in Org A gets a 404 (never a 403 that confirms existence) from GET /ai-runs/:id, ' +
      '/ai-runs/:id/score, and /ai-runs/:id/responses for a run id that belongs to Org B, even ' +
      'when given the id directly',
  );

  it.todo(
    'inserting an ai_runs row with organization_id set to a foreign org is rejected by WITH ' +
      'CHECK — covers POST /brands/me/ai-runs\'s ai_runs.create',
  );

  it.todo(
    'the background pipeline (lib/ai-visibility/pipeline.ts, run via setImmediate against a real ' +
      'ai_runs row) writing ai_run_responses and brand_observations rows for Org A\'s run can ' +
      'never be redirected into writing rows tagged with Org B\'s organization_id, even if the two ' +
      'runs are executing concurrently against the same process (withOrgContext\'s transaction-' +
      'local set_config must not leak between the two concurrent transactions)',
  );

  it.todo(
    'withOrgContext(orgA, ...) never returns Org B\'s ai_run_responses/brand_observations rows ' +
      'even though both are reachable only via a JOIN through ai_runs -> brands -> organizations, ' +
      'not a direct organizations FK — the denormalized organization_id column on both tables is ' +
      'what RLS actually filters on, same proof Epic 3\'s pages/page_issues block above establishes',
  );

  it.todo(
    'checkUsageLimit-style capping in POST /brands/me/ai-runs (ai_queries_per_month) — ' +
      'countAiQueriesThisMonth(orgA) sums ONLY Org A\'s ai_runs.total_jobs for the current month; ' +
      'Org B running a large AI Visibility run in the same month must never count against Org A\'s ' +
      'monthly limit or vice versa',
  );
});

/**
 * Epic 8 (Competitive Intelligence) — `ai_runs.competitor_id`. No new
 * table, no new RLS policy (the existing `tenant_isolation` policy on
 * `ai_runs`, added in 0008, already covers this column) — what's specific
 * to THIS epic, per docs/epics/08-competitive-intelligence.md's end-to-end
 * flow step 6, is proving that isolation holds across the competitor
 * dimension specifically, not just the org dimension Epic 7's block above
 * already covers generically.
 */
describe.skip('Epic 8 tenant isolation — competitor ai_runs (NEEDS LIVE DB)', () => {
  it.todo(
    'a user in Org A gets zero rows from GET /brands/me/competitors/:competitorId/ai-runs for a ' +
      'competitorId that belongs to Org B, even when both orgs happen to have a competitor with ' +
      'the exact same name (the route resolves the competitor via organization_id + brand_id, ' +
      'never by id alone)',
  );

  it.todo(
    'GET /brands/me/competitive-gaps and GET /brands/me/share-of-voice for Org A never include a ' +
      'competitor, run, or observation row that belongs to Org B, even when Org B tracks a ' +
      'competitor with the identical name and ran an identical query_set',
  );

  it.todo(
    'inserting an ai_runs row with organization_id set to a foreign org but competitor_id pointing ' +
      'at a REAL competitor owned by that same foreign org is still rejected by WITH CHECK — ' +
      'covers POST /brands/me/competitors/:competitorId/ai-runs\'s ai_runs.create',
  );

  it.todo(
    'countTrackedCompetitors(orgA, brandA) (the competitor-tracking entitlement counter) never ' +
      'counts Org B\'s tracked competitors, even though both orgs\' ai_runs rows are reachable only ' +
      'via the same table with no per-org partition beyond the RLS-enforced organization_id column',
  );
});

/**
 * Epic 18 (Agency / White Label / Integrations). `agency_clients` is the
 * one genuinely two-tenant table in the schema (`agency_org_id`,
 * `client_org_id`) — see @bebest/database rls.sql's "Special case —
 * agency_clients" and DECISIONS.md's Epic 18 section for why its policy
 * scopes visibility to the AGENCY side only, and why the client-side
 * accept/revoke paths (`routes/agency.ts`) deliberately use plain `db` +
 * an explicit `client_org_id` WHERE filter instead of a second RLS grant
 * (same precedent as `invitations`, see DECISIONS.md §7b). `integrations`/
 * `white_label_configs` use the standard single-`organization_id` policy —
 * no new RLS mechanics, but real coverage still matters because both hold
 * data this epic newly starts writing (mock OAuth tokens, custom branding).
 */
describe.skip('Epic 18 tenant isolation — agency_clients / integrations / white_label_configs (NEEDS LIVE DB)', () => {
  it.todo(
    'app.current_org = agencyOrgA sees ONLY agency_clients rows where agency_org_id = agencyOrgA — ' +
      'a link belonging to agencyOrgB (a different agency managing a different, or even the SAME, ' +
      'client org) is invisible, proving the two-tenant policy scopes on agency_org_id, not ' +
      'client_org_id',
  );

  it.todo(
    'app.current_org = clientOrgA (a client, not an agency) querying agency_clients directly via ' +
      'withOrgContext sees ZERO rows even for its OWN incoming invitations — confirming the policy ' +
      'really does scope to the agency side only, which is exactly why routes/agency.ts\'s ' +
      '/clients/incoming and /clients/:id/accept use plain `db` + an explicit client_org_id filter ' +
      'instead of relying on RLS for that direction',
  );

  it.todo(
    'inserting an agency_clients row with agency_org_id set to a foreign org (one app.current_org ' +
      'does not match) is rejected by WITH CHECK, even when client_org_id correctly points at a ' +
      'real, existing client org — an agency cannot forge a link FROM an org it does not control',
  );

  it.todo(
    'CRITICAL (mirrors the DoD requirement, exercised here against REAL RLS + a real row instead ' +
      'of a mock): with an active agency_clients row seeded, a request "acting as" the client org ' +
      'via withOrgContext(clientOrgId, ...) succeeds for a real tenant-table read; after UPDATEing ' +
      'that SAME row\'s status to \'revoked\' (still via the agency\'s own org_context, matching ' +
      'production), the identical subsequent read must return zero rows — proving revocation is ' +
      'enforced by the real authorization check on real data, not just in the mocked unit tests in ' +
      'lib/agency-access.test.ts and middleware/tenant-context.test.ts',
  );

  it.todo(
    'app.current_org = orgA sees ONLY its own integrations row(s) — a connected Search Console ' +
      'integration for orgB is invisible and does not affect orgA\'s resolveSEODataProviderForOrg ' +
      'provider selection',
  );

  it.todo(
    'app.current_org = orgA sees ONLY its own white_label_configs row — orgB\'s custom branding ' +
      '(logo/colors/custom domain) never leaks into orgA\'s GET /orgs/me/settings/white-label',
  );
});

/**
 * Epic 12 (GEO Agent / SEO Agent / Growth Agent). `agent_runs`/
 * `agent_events`/`agent_pending_actions` use the standard single-
 * `organization_id` `tenant_isolation` policy (no two-tenant special case
 * like Epic 18's `agency_clients`) — see @bebest/database schema.prisma's
 * "EPIC 12 — Agent Runner" comment block. Real coverage still matters
 * specifically for `agent_events`: it is genuinely append-only (no
 * `deleted_at`, never UPDATEd after insert), so a cross-tenant leak here
 * would expose another org's full step-by-step agent transparency log —
 * this epic's own "trust differentiator" — not just a single summary row.
 * `routes/agents.test.ts`/`routes/agent-run-details.test.ts` already prove
 * the mocked-Prisma version of this (a foreign-org id 404s); this block is
 * the real-RLS proof those unit tests cannot provide.
 */
describe.skip('Epic 12 tenant isolation — agent_runs / agent_events / agent_pending_actions (NEEDS LIVE DB)', () => {
  it.todo(
    'app.current_org = orgA sees ZERO agent_runs rows for a brand belonging to orgB, even when ' +
      'orgA and orgB each have their own brand and their own completed geo_agent run',
  );

  it.todo(
    'app.current_org = orgA cannot read orgB\'s agent_events via any agent_run_id, including one ' +
      'guessed/enumerated from orgA\'s own sequential-looking run ids — GET /agent-runs/:id\'s own ' +
      'explicit organization_id WHERE clause plus RLS both have to independently agree to return zero',
  );

  it.todo(
    'inserting an agent_runs (or agent_events, or agent_pending_actions) row with organization_id ' +
      'set to a foreign org is rejected by WITH CHECK, even when brand_id/agent_run_id correctly ' +
      'point at real rows the caller genuinely owns in their OWN org — proves the tenant column ' +
      'itself is enforced, not just the FK relationships',
  );

  it.todo(
    'CRITICAL: with a Level-3 agent_pending_actions row seeded for orgB, POST ' +
      '/agent-runs/:id/approve called with app.current_org = orgA (a real org that exists, just not ' +
      'the owner) returns 404 (via the explicit organization_id-scoped lookup), and the underlying ' +
      'row\'s status remains \'pending\' — confirms cross-tenant approval is impossible even for a ' +
      'run id that is not itself secret',
  );
});

/**
 * Epic 13 (Action Center & Controlled Publishing). `actions` (extended,
 * already had RLS from 0000_init) and `published_content` (genuinely new,
 * 0016's own rls.sql) both use the standard single-`organization_id`
 * `tenant_isolation` policy — see @bebest/database schema.prisma's "ACTION
 * CENTER" comment block. Real coverage matters specifically for the
 * approve/execute/rollback lifecycle: `routes/action-details.test.ts`
 * already proves the mocked-Prisma version of every guard clause (a
 * foreign-org id 404s, Level 4 is rejected regardless of approval state,
 * execute without approval is rejected, the 30-day window is enforced);
 * this block is the real-RLS proof those unit tests cannot provide —
 * specifically that RLS itself, not just this route's own explicit WHERE
 * clause, independently blocks a cross-tenant read/write.
 */
describe.skip('Epic 13 tenant isolation — actions / published_content (NEEDS LIVE DB)', () => {
  it.todo(
    'app.current_org = orgA sees ZERO actions rows for orgB\'s brand in GET /brands/me/actions, ' +
      'across all four sections (pending/in-progress/completed/rolled-back), even when orgB has at ' +
      'least one action in each status',
  );

  it.todo(
    'app.current_org = orgA cannot read/approve/execute/rollback orgB\'s action via any of ' +
      'POST /actions/:id/{approve,execute,rollback} — each returns 404 (via the route\'s own ' +
      'explicit organization_id WHERE clause) even for a real, existing action id from orgB, and ' +
      'RLS independently returns zero rows for the same query with app.current_org unset/mismatched',
  );

  it.todo(
    'inserting an actions (or published_content) row with organization_id set to a foreign org is ' +
      'rejected by WITH CHECK, even when brand_id/content_draft_id/agent_pending_action_id/action_id ' +
      'correctly point at real rows the caller genuinely owns in their OWN org — proves the tenant ' +
      'column itself is enforced, not just the FK relationships',
  );

  it.todo(
    'CRITICAL: with an approved, executed orgB action (and its published_content row) seeded, ' +
      'POST /actions/:id/rollback called with app.current_org = orgA (a real org that exists, just ' +
      'not the owner) returns 404, and both the underlying actions row and its published_content ' +
      'row remain untouched (status still \'completed\'/\'published\') — confirms a cross-tenant ' +
      'rollback cannot revert another org\'s published record even within the real 30-day window',
  );

  it.todo(
    'a content_drafts row belonging to orgB can never be referenced by an orgA actions row\'s ' +
      'content_draft_id — either the FK\'s own cross-schema reference fails, or (if the FK alone ' +
      'would technically allow it) RLS on content_drafts makes the row invisible to orgA\'s own ' +
      'approve handler in the first place, so the Epic 11 -> Epic 13 handoff can never cross a ' +
      'tenant boundary',
  );
});

/**
 * Epic 14 (Measurement & Learning Loop). `measurements` and
 * `outcome_records` (both genuinely new, 0017's own rls.sql) use the
 * standard single-`organization_id` `tenant_isolation` policy — see
 * @bebest/database schema.prisma's "MEASUREMENT & LEARNING LOOP" comment
 * block. `actions.before_score`/`.before_score_captured_at` are plain
 * columns on an already-RLS-protected table (0000_init), not repeated
 * here. Mocked-Prisma coverage already exists (`lib/measurement/*.test.ts`,
 * `routes/measurements.test.ts`, `routes/action-measurement.test.ts`,
 * including the immutability proof in `lib/measurement/
 * immutability.test.ts`); this block is the real-RLS proof those unit
 * tests cannot provide — specifically that RLS itself, not just each
 * route's own explicit WHERE clause, independently blocks a cross-tenant
 * read/write on these two new tables.
 */
describe.skip('Epic 14 tenant isolation — measurements / outcome_records (NEEDS LIVE DB)', () => {
  it.todo(
    'app.current_org = orgA sees ZERO rows for orgB\'s brand in GET /brands/me/measurements, even ' +
      'when orgB has at least one real, measured action',
  );

  it.todo(
    'GET /actions/:id/measurement for an orgB action, called with app.current_org = orgA, returns ' +
      '404 (via the route\'s own explicit organization_id WHERE clause on actions) — never leaking ' +
      'the existence of orgB\'s action OR its measurement via a 403 or a measured:false response ' +
      'for a real foreign row',
  );

  it.todo(
    'inserting a measurements (or outcome_records) row with organization_id set to a foreign org is ' +
      'rejected by WITH CHECK, even when action_id/brand_id/measurement_id correctly point at real ' +
      'rows the caller genuinely owns in their OWN org — proves the tenant column itself is ' +
      'enforced, not just the FK relationships',
  );

  it.todo(
    'CRITICAL: with an orgB action approved (before_score captured) and later measured, the ' +
      'background re-measurement job (runMeasurementForAction) running under app.current_org = ' +
      'orgB never becomes visible to, or writable by, an orgA session — a query for orgB\'s ' +
      'measurement/outcome_records rows with app.current_org = orgA returns zero rows',
  );

  it.todo(
    'a background job (system-triggered re-measurement, no HTTP request/session) still runs every ' +
      'query through withOrgContext(organizationId, ...) exactly like a request-triggered route ' +
      'does — confirms the 4-week trigger never bypasses RLS just because it has no Hono context',
  );
});

/**
 * Epic 15 (Reporting & Notifications). `reports` and `notifications` are
 * both PRE-EXISTING tables (0000_init's own `rls.sql`, ported — see
 * @bebest/database DECISIONS.md §29) whose `tenant_isolation` policy
 * predates this epic; this epic only widened their columns
 * (0018_reporting_notifications/checks.sql adds one CHECK, no new
 * rls.sql). Mocked-Prisma coverage already exists (`lib/reporting/
 * generate-report.test.ts`, `lib/notifications/notify.test.ts`,
 * `routes/reports.test.ts`, `routes/report-details.test.ts`, `routes/
 * notifications.test.ts`, including the immutability proof in `lib/
 * reporting/immutability.test.ts`); this block is the real-RLS proof
 * those unit tests cannot provide.
 */
describe.skip('Epic 15 tenant isolation — reports / notifications (NEEDS LIVE DB)', () => {
  it.todo(
    'app.current_org = orgA sees ZERO rows for orgB\'s brand in GET /brands/me/reports, even when ' +
      'orgB has at least one real, generated report',
  );

  it.todo(
    'GET /reports/:id for an orgB report, called with app.current_org = orgA, returns 404 (via the ' +
      'route\'s own explicit organization_id WHERE clause) — never leaking the existence of orgB\'s ' +
      'report via a 403 for a real foreign row',
  );

  it.todo(
    'inserting a reports (or notifications) row with organization_id set to a foreign org is ' +
      'rejected by WITH CHECK, even when brand_id/created_by correctly point at real rows the ' +
      'caller genuinely owns in their OWN org — proves the tenant column itself is enforced, not ' +
      'just the FK relationships',
  );

  it.todo(
    'GET /notifications with app.current_org = orgA never returns an orgB notification, per-user ' +
      '(user_id set) or org-wide (user_id null) — RLS blocks the row outright before this route\'s ' +
      'own (user_id = caller OR user_id IS NULL) visibility filter even runs',
  );

  it.todo(
    'POST /notifications/:id/read for an orgB notification, called with app.current_org = orgA, ' +
      'returns 404 and leaves the underlying row\'s read_at untouched — a cross-tenant caller can ' +
      'never mark another org\'s notification read',
  );
});
