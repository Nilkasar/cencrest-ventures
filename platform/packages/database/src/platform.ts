/**
 * `platformDb` — the cross-tenant Prisma client behind Epic 22's Platform
 * view (`/api/platform/*`). Exported from its own entry point,
 * `@bebest/database/platform`, so that importing `@bebest/database` never
 * pulls it in.
 *
 * WHY A SECOND CLIENT AT ALL
 *
 * Every request the API serves runs as `bebest_app`, which cannot bypass
 * RLS — that is the tenant-isolation guarantee (ADR-005), and
 * `rls-check.ts` refuses to let it be otherwise in production. BeBest staff
 * genuinely need to see across tenants (all orgs, all users, every job), so
 * that access needs a DIFFERENT Postgres role: `bebest_platform`, created by
 * `scripts/create-platform-role.sql`, the one role besides the migration
 * owner that may bypass RLS. Giving `bebest_app` a way around RLS "just for
 * staff routes" would put the bypass one bug away from every customer route.
 * A separate connection on a separate role keeps the blast radius to the
 * code that holds this client.
 *
 * WHO MAY HOLD IT
 *
 * Only `apps/api/src/routes/platform/**` — enforced by a
 * `no-restricted-imports` rule in `apps/api/eslint.config.mjs` — and only
 * behind `requirePlatformRole`, which re-reads the caller's
 * `users.platform_role` and writes a `platform_access_events` row before the
 * handler runs.
 *
 * LAZY, BY DESIGN
 *
 * `PLATFORM_DATABASE_URL` is optional configuration: a deployment that has
 * not provisioned `bebest_platform` must still boot and serve every customer
 * route. So nothing happens at import time. The client is constructed on
 * first use, and if the variable is unset that first use throws
 * `PlatformDatabaseNotConfiguredError` — a clear, specific failure on the
 * one route that needed it, never a crash of the whole API.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

// Same transport as `client.ts` (see its "Connection transport" comment).
neonConfig.webSocketConstructor = ws;

export class PlatformDatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'PLATFORM_DATABASE_URL is not set. The Platform API needs a connection as the ' +
        '`bebest_platform` role — see packages/database/scripts/create-platform-role.sql ' +
        'and GO_LIVE.md §1.2.',
    );
    this.name = 'PlatformDatabaseNotConfiguredError';
  }
}

type GlobalWithPlatformPrisma = typeof globalThis & { __bebestPlatformPrisma?: PrismaClient };
const globalForPlatform = globalThis as GlobalWithPlatformPrisma;

function createPlatformClient(): PrismaClient {
  const connectionString = process.env.PLATFORM_DATABASE_URL;
  if (!connectionString) throw new PlatformDatabaseNotConfiguredError();

  const log: Prisma.LogLevel[] =
    process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];

  if (process.env.PRISMA_DRIVER === 'engine') {
    return new PrismaClient({ log, datasourceUrl: connectionString });
  }

  // A smaller pool than the request client: staff traffic is a handful of
  // people, and every connection here is one that can read every tenant.
  const adapter = new PrismaNeon({
    connectionString,
    max: Number(process.env.PLATFORM_DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
  });

  return new PrismaClient({ adapter, log });
}

/**
 * Returns the platform client, constructing it on first call. Throws
 * `PlatformDatabaseNotConfiguredError` when `PLATFORM_DATABASE_URL` is unset;
 * a later call retries, so setting the variable does not need a re-import.
 */
export function getPlatformDb(): PrismaClient {
  if (!globalForPlatform.__bebestPlatformPrisma) {
    globalForPlatform.__bebestPlatformPrisma = createPlatformClient();
  }
  return globalForPlatform.__bebestPlatformPrisma;
}

/**
 * The cross-tenant client as a value, for call sites that read better as
 * `platformDb.organizations.findMany(...)`. A thin proxy over
 * `getPlatformDb()`: the first property access constructs the client (or
 * throws `PlatformDatabaseNotConfiguredError`); importing it does nothing.
 */
export const platformDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPlatformDb();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

/** Test-only: forget the constructed client so a test can exercise
 *  construction again. Never called by application code. */
export function __resetPlatformDbForTesting(): void {
  delete globalForPlatform.__bebestPlatformPrisma;
}
