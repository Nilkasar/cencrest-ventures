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
