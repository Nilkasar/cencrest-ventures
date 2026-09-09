/**
 * Startup verification that Row-Level Security is actually in effect.
 *
 * Every tenant table in this schema has RLS enabled and FORCEd, and every
 * scoped query goes through `withOrgContext`. None of that does anything if
 * the role the API connects as can bypass RLS — and the failure is
 * completely silent: the application works, the tests pass, and every
 * tenant sees every other tenant's rows.
 *
 * That is not hypothetical. The development database for this project runs
 * as a managed provider's default owner role, which carries `BYPASSRLS`;
 * a query deliberately scoped to the WRONG organization returned every row
 * in the table. The policies were correct the whole time. Nothing in the
 * application could tell.
 *
 * So the application asks Postgres directly, at boot, and says so out loud.
 *
 * Two independent ways a role escapes RLS:
 *   1. `rolbypassrls` (or superuser) — bypasses every policy, always.
 *   2. Owning the table — bypasses policies UNLESS the table is FORCEd.
 *      This schema does FORCE, so ownership alone is survivable, but it is
 *      still the wrong role to serve requests as and is reported.
 *
 * See GO_LIVE.md §1.2: the API should connect as `bebest_app` — a role with
 * neither attribute.
 */
import { db } from './client.js';

export interface RlsStatus {
  role: string;
  /** True when the role bypasses every policy: superuser or BYPASSRLS. */
  bypassesRls: boolean;
  isSuperuser: boolean;
  hasBypassRls: boolean;
  /** Tenant tables this role owns. Survivable here (policies are FORCEd) but
   *  not what a request-serving role should look like. */
  ownedTenantTables: number;
  /** The empirical answer: rows visible under an organization context that
   *  should match nothing. Anything above zero means isolation is off. */
  leakedRowsUnderForeignContext: number | null;
}

const IMPOSSIBLE_ORG = '00000000-0000-4000-8000-000000000000';

/**
 * Asks the database what it will actually enforce. Never throws — a
 * diagnostic that takes the process down is worse than the thing it
 * diagnoses — so a failure to answer reports `null` for the empirical
 * check and leaves the caller to decide.
 */
export async function checkRlsEnforcement(): Promise<RlsStatus> {
  const [role] = await db.$queryRaw<
    { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT rolname::text AS rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

  const [owned] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tableowner = current_user
       AND tablename IN ('leads', 'deals', 'activities')
  `;

  // The check that cannot be argued with: scope to an organization that owns
  // nothing and count what comes back. Under working RLS this is always 0.
  let leaked: number | null = null;
  try {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM (
        SELECT set_config('app.current_org', ${IMPOSSIBLE_ORG}, true)
      ) AS ctx, leads
    `;
    leaked = row ? Number(row.count) : null;
  } catch {
    // The table may not exist yet (a fresh database mid-migration). Not
    // knowing is reported as not knowing.
    leaked = null;
  }

  const isSuperuser = role?.rolsuper ?? false;
  const hasBypassRls = role?.rolbypassrls ?? false;

  return {
    role: role?.rolname ?? 'unknown',
    isSuperuser,
    hasBypassRls,
    bypassesRls: isSuperuser || hasBypassRls,
    ownedTenantTables: owned ? Number(owned.count) : 0,
    leakedRowsUnderForeignContext: leaked,
  };
}

/**
 * Runs the check and reports it.
 *
 * In production a role that bypasses RLS is fatal: the process refuses to
 * start rather than serve requests with tenant isolation quietly disabled.
 * Everywhere else it is a loud warning, because a developer database owned
 * by its own superuser is normal and blocking local work over it would only
 * teach people to skip the check.
 */
export async function assertRlsEnforced(options: { fatal?: boolean } = {}): Promise<RlsStatus> {
  const fatal = options.fatal ?? process.env.NODE_ENV === 'production';
  const status = await checkRlsEnforcement();

  const problems: string[] = [];
  if (status.bypassesRls) {
    problems.push(
      `the connected role "${status.role}" ${status.isSuperuser ? 'is a superuser' : 'has BYPASSRLS'}, so every tenant_isolation policy is ignored`,
    );
  }
  if (status.ownedTenantTables > 0) {
    problems.push(`"${status.role}" owns ${status.ownedTenantTables} tenant table(s)`);
  }
  if (status.leakedRowsUnderForeignContext && status.leakedRowsUnderForeignContext > 0) {
    problems.push(
      `a query scoped to an organization that owns nothing still returned ${status.leakedRowsUnderForeignContext} lead(s)`,
    );
  }

  if (problems.length === 0) {
    console.warn(
      JSON.stringify({ level: 'info', msg: 'rls_enforced', role: status.role }),
    );
    return status;
  }

  const message = `Row-Level Security is NOT being enforced: ${problems.join('; ')}. Connect as a role with neither BYPASSRLS nor ownership of the tenant tables — see GO_LIVE.md §1.2 and packages/database/scripts/create-app-role.sql.`;

  if (fatal) throw new Error(message);
  console.warn(JSON.stringify({ level: 'warn', msg: 'rls_not_enforced', detail: message }));
  return status;
}
