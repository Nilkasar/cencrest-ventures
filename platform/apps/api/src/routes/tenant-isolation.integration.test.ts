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
