/**
 * Typed Prisma client wrapper — the ONLY module in the monorepo allowed to
 * import `@prisma/client`. `apps/api` (and any future app) imports from
 * `@bebest/database` instead, never from `@prisma/client` directly.
 *
 * Why this file exists (not just re-exporting `new PrismaClient()`):
 *
 * Every tenant table has Row-Level Security FORCEd on it (see
 * prisma/migrations/0000_init/rls.sql). Postgres evaluates each table's
 * `tenant_isolation` policy against the `app.current_org` session variable.
 * If that variable was never set, the policy compares `organization_id` to
 * NULL, which is never true — so an un-scoped query sees zero rows. That is
 * the correct, fail-closed behavior for request-handling code, but it means
 * EVERY tenant query must run inside a short-lived transaction that first
 * sets `app.current_org` for that transaction only (`set_config(..., true)`
 * is transaction-scoped in Postgres — the value evaporates on
 * COMMIT/ROLLBACK, so there is no risk of leaking one request's org into
 * the next request on a pooled connection).
 *
 * `withOrgContext` below is that mechanism, centralized in one place so no
 * route handler can forget to scope a query. See
 * apps/api/src/middleware/tenant-context.ts for how the API wires this to
 * the authenticated request's `org` JWT claim.
 *
 * Two Postgres roles are required in any real deployment (documented in
 * DECISIONS.md because we cannot provision them ourselves — Epic 0 never
 * connects to a database):
 *   - `bebest_app`   — used by this wrapper for all request traffic. Must
 *                      NOT have BYPASSRLS and must NOT own the tables
 *                      (table owners bypass RLS unless the table is also
 *                      FORCEd, which we do, but a non-owning, non-bypass
 *                      role is the clearer, defense-in-depth default).
 *   - `bebest_admin` — used only for `prisma migrate deploy`, seeding, and
 *                      offline/admin tooling that legitimately needs
 *                      cross-tenant access. Never used to serve a request.
 */

import { PrismaClient, type Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Base client (singleton, hot-reload safe in dev)
// ---------------------------------------------------------------------------

type GlobalWithPrisma = typeof globalThis & { __bebestPrisma?: PrismaClient };
const globalForPrisma = globalThis as GlobalWithPrisma;

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/**
 * The raw, UN-SCOPED Prisma client. Use this ONLY for:
 *   - queries against tables that intentionally have no RLS (see the list
 *     in rls.sql: organizations, users, memberships, sessions, etc.)
 *   - system/background code that has its own cross-tenant authorization
 *     model and runs against the `bebest_admin` role
 *
 * Request-handling code that touches a tenant table MUST use
 * `withOrgContext` instead. There is no runtime guard that stops you from
 * misusing `db` directly on a tenant table — that is exactly what RLS
 * exists to catch: if `db` is pointed at the `bebest_app` role, a forgotten
 * `withOrgContext` wrapper fails closed (zero rows), not open.
 */
export const db: PrismaClient = globalForPrisma.__bebestPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__bebestPrisma = db;
}

// ---------------------------------------------------------------------------
// Tenant-scoped access
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidOrganizationIdError extends Error {
  constructor(value: string) {
    super(`Refusing to set tenant context: "${value}" is not a valid UUID`);
    this.name = 'InvalidOrganizationIdError';
  }
}

/**
 * Runs `fn` with `app.current_org` set to `organizationId` for the duration
 * of a single database transaction, so every tenant-table RLS policy scopes
 * to this org. This is the ONLY sanctioned way to run a query against a
 * tenant table.
 *
 * Usage (inside a route handler, after auth + RBAC middleware has already
 * verified the caller belongs to `organizationId`):
 *
 *   const brands = await withOrgContext(orgId, (tx) => tx.brands.findMany());
 *
 * Implementation notes:
 *   - `set_config('app.current_org', $1, true)` is used (a function call)
 *     rather than `SET LOCAL app.current_org = $1` because Postgres's `SET`
 *     statement does not accept bind parameters — `set_config` does, so
 *     Prisma's tagged-template `$executeRaw` parameterizes it safely. This
 *     is a defense-in-depth belt: `organizationId` is also validated as a
 *     UUID up front, so even a caller that bypassed type-checking cannot
 *     inject SQL here.
 *   - The third argument `true` to `set_config` makes it transaction-local
 *     (equivalent to `SET LOCAL`), so pooled connections never leak one
 *     request's tenant context into the next.
 */
export async function withOrgContext<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) {
    throw new InvalidOrganizationIdError(organizationId);
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`;
    return fn(tx);
  });
}

export class InvalidUserIdError extends Error {
  constructor(value: string) {
    super(`Refusing to set user context: "${value}" is not a valid UUID`);
    this.name = 'InvalidUserIdError';
  }
}

/**
 * Runs `fn` with `app.current_user` set to `userId` for the duration of a
 * single transaction. This is the ONLY sanctioned way to query
 * `memberships` (see rls.sql's "Special case — memberships" note): that
 * table is scoped by `user_id`, not `organization_id`, because a user must
 * be able to list every org they belong to before any single org has been
 * chosen — e.g. the post-login "which orgs am I in" call, or the
 * org-switcher. Once a specific org is chosen, subsequent tenant-table
 * queries for that request use `withOrgContext` instead.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new InvalidUserIdError(userId);
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user', ${userId}, true)`;
    return fn(tx);
  });
}

/**
 * Runs `fn` with BOTH `app.current_user` and `app.current_org` set, for the
 * (less common) request that needs to read `memberships` and a tenant
 * table in the same transaction — e.g. changing a teammate's role, which
 * checks the target's current membership row and then writes an
 * `audit_events` row scoped to the org, atomically.
 */
export async function withUserAndOrgContext<T>(
  userId: string,
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) throw new InvalidUserIdError(userId);
  if (!UUID_RE.test(organizationId)) throw new InvalidOrganizationIdError(organizationId);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user', ${userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`;
    return fn(tx);
  });
}

/** Convenience alias for readability at call sites: `forOrg(orgId).brands.findMany()`-style
 * usage is NOT supported (Prisma has no lazy proxy that survives outside the
 * transaction callback) — always use the callback form above. This export
 * exists only so route code can write `import { withOrgContext as forOrg }`
 * if it prefers the shorter name; it is not a second implementation.
 */
export const forOrg = withOrgContext;

// ---------------------------------------------------------------------------
// Re-exported types — so apps/api never needs `import ... from '@prisma/client'`
// ---------------------------------------------------------------------------

export type { Prisma } from '@prisma/client';
export type {
  organizations,
  users,
  memberships,
  invitations,
  sessions,
  refresh_tokens,
  magic_link_tokens,
  password_reset_tokens,
  auth_events,
  audit_events,
  brands,
  competitors,
  brand_entities,
  use_cases,
  brand_claims,
  claim_confidence,
  role,
  job_status,
  job_type,
  run_status,
  subscription_status,
  // Epic 16 (Billing)
  plans,
  subscriptions,
  usage_records,
  usage_metric,
  billing_webhook_events,
  // Epic 1 (CRM)
  leads,
  deals,
  activities,
  lead_source,
  lead_status,
  deal_stage,
  activity_type,
  // Epic 5 (Intent & Query Universe)
  query_sets,
  queries,
  // Epic 3 (Website Intelligence)
  crawl_jobs,
  pages,
  page_issues,
  sitemaps,
  crawl_status,
  issue_type,
  issue_severity,
  // Epic 4 (SEO Intelligence)
  keyword_groups,
  seo_keywords,
  seo_analyses,
  seo_opportunities,
  keyword_intent,
  seo_keyword_confidence,
  seo_provider_source,
  seo_analysis_type,
  opportunity_status,
  // Epic 7 (AI Visibility Engine)
  ai_runs,
  ai_run_responses,
  brand_observations,
} from '@prisma/client';

export type PrismaTransactionClient = Prisma.TransactionClient;
