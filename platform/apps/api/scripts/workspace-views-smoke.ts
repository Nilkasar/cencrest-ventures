/**
 * End-to-end smoke test for Epic 22 Phase 0 (Workspace Views) against a
 * RUNNING API and a REAL database. Real HTTP, real RS256 tokens, real rows.
 *
 *   pnpm --filter @bebest/api run smoke:workspaces
 *
 * What it proves, in order:
 *   1. A brand-new customer's `GET /auth/me` carries `platformRole: 'none'`,
 *      each organization's `kind`, and an empty `agencyClients`.
 *   2. That customer gets 403 from `GET /platform/session` and NO
 *      `platform_access_events` row is written.
 *   3. Granting `platform_role = 'support'` in SQL — same token, no
 *      re-login — turns the very next call into a 200 that writes exactly
 *      one access event. The guard re-reads the database; the token carries
 *      no platform role at all.
 *   4. The request-serving role (`bebest_app`) cannot read or delete that
 *      event — the table is append-only for it (0023_workspace_views/rls.sql).
 *   5. Revoking the grant bites on the next request: 403, no new row.
 *   6. An agency member's `/auth/me` lists the agency's ACTIVE client links
 *      (invite → client accepts → link shows up), and a pending link does not.
 *
 * Prerequisites: the API running (`pnpm --filter @bebest/api dev`, or
 * `SMOKE_API_URL` pointing at one), `apps/api/.env` populated (DATABASE_URL
 * as the app role, JWT keys), and migration 0023 applied (`db:apply`).
 *
 * Two connections, deliberately:
 *   - the app's own `db` (DATABASE_URL — `bebest_app`), for what the API
 *     itself can and cannot see;
 *   - an owner/admin connection (`SMOKE_ADMIN_DATABASE_URL`, else
 *     `packages/database/.env`'s DATABASE_URL — the URL `db:apply` uses) to
 *     grant `platform_role` "via SQL", as Phase 0 does, and to count
 *     `platform_access_events`, which the app role is not allowed to read.
 *
 * Writes real rows (two users, three orgs, one link per run). Point it at a
 * development database, never production.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, importPKCS8 } from 'jose';
// `pg` is @bebest/database's own driver dependency, resolved through the
// workspace's hoisted node_modules (.npmrc `shamefully-hoist=true`).
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API = process.env.SMOKE_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}/api`;

function adminDatabaseUrl(): string | undefined {
  if (process.env.SMOKE_ADMIN_DATABASE_URL) return process.env.SMOKE_ADMIN_DATABASE_URL;
  const file = path.resolve(APP_ROOT, '../../packages/database/.env');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  return line?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
}

const ADMIN_URL = adminDatabaseUrl();
if (!process.env.JWT_PRIVATE_KEY || !process.env.DATABASE_URL || !ADMIN_URL) {
  console.error(
    'Missing JWT_PRIVATE_KEY / DATABASE_URL (apps/api/.env) or an admin database URL ' +
      '(SMOKE_ADMIN_DATABASE_URL, or packages/database/.env).',
  );
  process.exit(1);
}

const admin = new pg.Client({
  connectionString: ADMIN_URL,
  ssl: ADMIN_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await admin.connect();

// Imported only now, AFTER apps/api/.env is loaded: a static import is
// evaluated before any statement in this module runs, so `db` would be
// built with DATABASE_URL unset — and Prisma would then fall back to
// loading packages/database/.env on its own, i.e. the OWNER role. The
// checks below are about what the app role can see, so that matters.
const { db } = await import('@bebest/database');
const [appRole] = await db.$queryRaw<{ rolname: string; bypass: boolean }[]>`
  SELECT rolname::text AS rolname, (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user
`;
console.log(`app connection role: ${appRole?.rolname} (bypasses RLS: ${appRole?.bypass})`);
if (!appRole || appRole.bypass) {
  console.error('The app DATABASE_URL must be a role that cannot bypass RLS (bebest_app) for these checks to mean anything.');
  process.exit(1);
}

const signingKey = await importPKCS8(process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
async function tokenFor(user: { id: string; email: string }, org: string | null = null): Promise<string> {
  return new SignJWT({ email: user.email, org })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey);
}

interface Result {
  label: string;
  ok: boolean;
}
const results: Result[] = [];

function check(label: string, ok: boolean, detail?: unknown): void {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) console.log('        got:', JSON.stringify(detail)?.slice(0, 400));
}

async function call(
  method: string,
  urlPath: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function accessEventCount(userId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from platform_access_events where user_id = $1',
    [userId],
  );
  return rows[0]?.n ?? -1;
}

async function setPlatformRole(userId: string, role: 'none' | 'support' | 'admin'): Promise<void> {
  await admin.query('update users set platform_role = $1, updated_at = now() where id = $2', [role, userId]);
}

console.log(`=== Workspace views smoke against ${API} ===\n`);
const stamp = Date.now();

// ── 1–2. A plain customer ────────────────────────────────────────────────
const customer = await db.users.create({
  data: { email: `ws-customer-${stamp}@example.com`, name: 'WS Customer', email_verified: true },
});
const customerToken = await tokenFor(customer);

const customerOrg = await call('POST', '/orgs', customerToken, { name: `WS Customer ${stamp}` });
check('customer creates an organization (201)', customerOrg.status === 201, customerOrg);

const customerMe = await call('GET', '/auth/me', customerToken);
check('GET /auth/me → 200', customerMe.status === 200, customerMe);
check("customer platformRole is 'none'", customerMe.body?.platformRole === 'none', customerMe.body);
check(
  "customer's organization carries kind 'customer'",
  customerMe.body?.organizations?.length === 1 &&
    customerMe.body.organizations[0].slug === customerOrg.body?.slug &&
    customerMe.body.organizations[0].kind === 'customer' &&
    customerMe.body.organizations[0].role === 'owner',
  customerMe.body?.organizations,
);
check(
  'customer has no agencyClients',
  Array.isArray(customerMe.body?.agencyClients) && customerMe.body.agencyClients.length === 0,
  customerMe.body?.agencyClients,
);

const denied = await call('GET', '/platform/session', customerToken);
check('customer → GET /platform/session is 403', denied.status === 403, denied);
check(
  "403 body is { error: 'Platform access required' }",
  denied.body?.error === 'Platform access required',
  denied.body,
);
check('a denied call writes NO platform_access_events row', (await accessEventCount(customer.id)) === 0);

// ── 3–5. Grant support via SQL, same token ───────────────────────────────
await setPlatformRole(customer.id, 'support');
const meAsSupport = await call('GET', '/auth/me', customerToken);
check("after the SQL grant, /auth/me says 'support' (same token)", meAsSupport.body?.platformRole === 'support');

const allowed = await call('GET', '/platform/session', customerToken);
check('support → GET /platform/session is 200', allowed.status === 200, allowed);
check(
  'session body is { platformRole, user: { id, email, name } }',
  allowed.body?.platformRole === 'support' &&
    allowed.body?.user?.id === customer.id &&
    allowed.body?.user?.email === customer.email &&
    allowed.body?.user?.name === customer.name,
  allowed.body,
);
check('exactly one platform_access_events row was written', (await accessEventCount(customer.id)) === 1);

const { rows: eventRows } = await admin.query(
  `select platform_role, action, method, request_path, target_org_id, target_user_id
     from platform_access_events where user_id = $1`,
  [customer.id],
);
const event = eventRows[0];
check(
  'the row records role, action, method and path',
  event?.platform_role === 'support' &&
    event?.action === 'GET /api/platform/session' &&
    event?.method === 'GET' &&
    event?.request_path === '/api/platform/session' &&
    event?.target_org_id === null &&
    event?.target_user_id === null,
  event,
);

// The app role can append but never read or remove: RLS FORCEd, INSERT-only.
const visibleToApp = await db.$queryRaw<{ n: bigint }[]>`
  SELECT count(*) AS n FROM platform_access_events WHERE user_id = ${customer.id}::uuid
`;
check('bebest_app reads 0 access events (append-only for the request role)', Number(visibleToApp[0]?.n) === 0);
const deletedByApp = await db.$executeRaw`
  DELETE FROM platform_access_events WHERE user_id = ${customer.id}::uuid
`;
check(
  'bebest_app cannot delete an access event',
  deletedByApp === 0 && (await accessEventCount(customer.id)) === 1,
);

await setPlatformRole(customer.id, 'none');
const revoked = await call('GET', '/platform/session', customerToken);
check('revoking the grant bites on the next request (403, same token)', revoked.status === 403, revoked);
check('…and writes nothing', (await accessEventCount(customer.id)) === 1);

// ── 6. Agency member ─────────────────────────────────────────────────────
const agencyOwner = await db.users.create({
  data: { email: `ws-agency-${stamp}@example.com`, name: 'WS Agency', email_verified: true },
});
const agencyOwnerToken = await tokenFor(agencyOwner);
const agencyOrg = await call('POST', '/orgs', agencyOwnerToken, { name: `WS Agency ${stamp}` });
check('agency owner creates an organization (201)', agencyOrg.status === 201, agencyOrg);

// What the 0023 backfill / plan entitlement would decide: this org works as
// an agency. Phase 0 has no route that sets `kind` (see the backend report).
await admin.query("update organizations set kind = 'agency' where id = $1", [agencyOrg.body.id]);

const clientOrg = await call('POST', '/orgs', customerToken, { name: `WS Client ${stamp}` });
check('client owner creates the client organization (201)', clientOrg.status === 201, clientOrg);

const invite = await call(
  'POST',
  '/agency/clients',
  await tokenFor(agencyOwner, agencyOrg.body.id),
  { clientOrgSlug: clientOrg.body.slug, role: 'analyst' },
);
check('agency invites the client (201, pending)', invite.status === 201 && invite.body?.status === 'pending', invite);

const mePending = await call('GET', '/auth/me', agencyOwnerToken);
check(
  "agency org shows kind 'agency' on /auth/me",
  mePending.body?.organizations?.some((o: any) => o.id === agencyOrg.body.id && o.kind === 'agency'),
  mePending.body?.organizations,
);
check(
  'a PENDING link is not listed in agencyClients',
  Array.isArray(mePending.body?.agencyClients) && mePending.body.agencyClients.length === 0,
  mePending.body?.agencyClients,
);

const accept = await call(
  'POST',
  `/agency/clients/${invite.body.id}/accept`,
  await tokenFor(customer, clientOrg.body.id),
);
check('client accepts the invitation (200)', accept.status === 200, accept);

const meActive = await call('GET', '/auth/me', agencyOwnerToken);
const listed = meActive.body?.agencyClients ?? [];
check(
  'the ACTIVE link is listed in agencyClients with slug, name, accessLevel and status',
  listed.length === 1 &&
    listed[0].organizationId === clientOrg.body.id &&
    listed[0].slug === clientOrg.body.slug &&
    listed[0].name === clientOrg.body.name &&
    listed[0].accessLevel === 'limited' &&
    listed[0].status === 'active' &&
    listed[0].agencyOrganizationId === agencyOrg.body.id,
  listed,
);

const clientMe = await call('GET', '/auth/me', customerToken);
check(
  'the client side (a customer org) gets no agencyClients',
  Array.isArray(clientMe.body?.agencyClients) && clientMe.body.agencyClients.length === 0,
  clientMe.body?.agencyClients,
);

const agencyDenied = await call('GET', '/platform/session', agencyOwnerToken);
check('an agency member is not platform staff (403)', agencyDenied.status === 403, agencyDenied);

// ── Summary ──────────────────────────────────────────────────────────────
await admin.end();
await db.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.label}`);
  process.exit(1);
}
process.exit(0);
