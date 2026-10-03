/**
 * End-to-end smoke test for Epic 22 Phase 1 (Platform view API) against a
 * RUNNING API and a REAL database. Real HTTP, real RS256 tokens, real rows.
 *
 *   pnpm --filter @bebest/api run smoke:platform
 *
 * Proves:
 *   1. A customer (platform_role 'none') gets 403 from every Platform route
 *      and leaves no platform_access_events row behind.
 *   2. Support staff get 200 with sane, real data from overview,
 *      capabilities, orgs (+ detail), users (+ detail), agencies (+ clients),
 *      jobs, audit and growth/snapshots — and EVERY allowed call writes
 *      exactly one platform_access_events row (org detail with target_org_id).
 *   3. Cross-tenant read: staff see an org (members, runs, links) they are
 *      not a member of.
 *   4. Pagination caps (limit=500 → 100), malformed input (422) and
 *      malformed/unknown ids (404).
 *   5. Admin-only writes: support → 403; admin cancels deliberately-stuck
 *      crawl / agent-run / snapshot rows → each table's terminal vocabulary,
 *      an audit_events row per cancel; a second cancel → 409. Admin sends a
 *      magic link → token row + audit row, link never in the response.
 *   6. CRM from the Platform view: staff list leads while their token
 *      selects a CUSTOMER org; a non-staff customer gets 403 on the same call.
 *   7. Latency per route (overview target < 1500ms warm).
 *
 * Prerequisites: API running (`SMOKE_API_URL`, default http://localhost:$PORT/api),
 * apps/api/.env with DATABASE_URL (bebest_app), JWT keys, CRM_INTERNAL_ORG_ID
 * and PLATFORM_DATABASE_URL; an owner connection (SMOKE_ADMIN_DATABASE_URL,
 * else packages/database/.env) for seeding and for counting rows the app
 * role cannot read. Writes real rows — development databases only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, importPKCS8 } from 'jose';
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
if (!process.env.JWT_PRIVATE_KEY || !ADMIN_URL || !process.env.PLATFORM_DATABASE_URL || !process.env.CRM_INTERNAL_ORG_ID) {
  console.error('Missing JWT_PRIVATE_KEY / PLATFORM_DATABASE_URL / CRM_INTERNAL_ORG_ID (apps/api/.env) or an admin database URL.');
  process.exit(1);
}

const admin = new pg.Client({
  connectionString: ADMIN_URL,
  ssl: ADMIN_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
// A dropped idle socket (Neon recycles them) must not crash the run.
admin.on('error', (err) => console.warn(`admin connection error: ${err.message}`));
await admin.connect();

const signingKey = await importPKCS8(process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
async function tokenFor(user: { id: string; email: string }, org: string | null = null): Promise<string> {
  return new SignJWT({ email: user.email, org })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey);
}

const results: { label: string; ok: boolean }[] = [];
function check(label: string, ok: boolean, detail?: unknown): void {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) console.log('        got:', JSON.stringify(detail)?.slice(0, 600));
}

const latencies: { route: string; ms: number; status: number }[] = [];
async function call(method: string, urlPath: string, token: string, body?: unknown): Promise<{ status: number; body: any; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, ms };
}

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await admin.query(sql, params)).rows as T[];
}
async function accessEvents(userId: string): Promise<number> {
  return (await q<{ n: number }>('select count(*)::int n from platform_access_events where user_id = $1', [userId]))[0]!.n;
}
async function createUser(label: string): Promise<{ id: string; email: string }> {
  const email = `pf-${label}-${stamp}@example.com`;
  const [row] = await q<{ id: string }>(
    `insert into users (email, name, email_verified) values ($1, $2, true) returning id`,
    [email, `PF ${label}`],
  );
  return { id: row!.id, email };
}
async function setRole(userId: string, role: 'none' | 'support' | 'admin'): Promise<void> {
  await q('update users set platform_role = $1, updated_at = now() where id = $2', [role, userId]);
}

/** A staff GET that must be 200 and write exactly one access event. */
async function staffGet(label: string, urlPath: string, token: string, userId: string): Promise<any> {
  const before = await accessEvents(userId);
  const res = await call('GET', urlPath, token);
  latencies.push({ route: `GET ${urlPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').split('?')[0]}`, ms: res.ms, status: res.status });
  check(`${label} → 200`, res.status === 200, res);
  check(`${label} wrote exactly one platform_access_events row`, (await accessEvents(userId)) === before + 1);
  return res.body;
}

const stamp = Date.now();
console.log(`=== Platform view (Epic 22 Phase 1) smoke against ${API} ===\n`);

// ── Seed ─────────────────────────────────────────────────────────────────
const customer = await createUser('customer');
const staff = await createUser('staff');
const customerToken = await tokenFor(customer);

const orgA = await call('POST', '/orgs', customerToken, { name: `PF Client ${stamp}` });
check('customer creates org A (201)', orgA.status === 201, orgA);
const orgB = await call('POST', '/orgs', customerToken, { name: `PF Agency ${stamp}` });
check('customer creates org B (201)', orgB.status === 201, orgB);
const A = orgA.body.id as string;
const B = orgB.body.id as string;
const staffOwnOrg = await call('POST', '/orgs', await tokenFor(staff), { name: `PF Staff Own ${stamp}` });
check("staff creates their own customer org (201)", staffOwnOrg.status === 201, staffOwnOrg);

await q("update organizations set kind = 'agency' where id = $1", [B]);
await q(
  `insert into agency_clients (agency_org_id, client_org_id, status, access_level, consented_at) values ($1, $2, 'active', 'read_only', now())`,
  [B, A],
);
const [brand] = await q<{ id: string }>(
  `insert into brands (organization_id, name, website_url, created_by, aliases, differentiators)
   values ($1, $2, 'https://pf-example.com', $3, '{}', '{}') returning id`,
  [A, `PF Brand ${stamp}`, customer.id],
);
const [crawl] = await q<{ id: string }>(
  `insert into crawl_jobs (organization_id, brand_id, root_url, status, started_at, created_at)
   values ($1, $2, 'https://pf-example.com', 'running', now() - interval '2 hours', now() - interval '2 hours') returning id`,
  [A, brand!.id],
);
const [agentRun] = await q<{ id: string }>(
  `insert into agent_runs (organization_id, brand_id, agent_name, agent_version, status, triggered_by, created_at)
   values ($1, $2, 'geo_agent', '1.0.0', 'queued', 'schedule', now() - interval '1 hour') returning id`,
  [A, brand!.id],
);
const [snapshot] = await q<{ id: string }>(
  `insert into snapshot_requests (domain, email, status, token_hash, created_at)
   values ($1, $2, 'processing', $3, now() - interval '1 hour') returning id`,
  [`pf-${stamp}.example.com`, customer.email, randomBytes(32).toString('hex')],
);

// ── 1. Non-staff: 403 everywhere, no rows ────────────────────────────────
const ROUTES: [string, string][] = [
  ['GET', '/platform/overview'],
  ['GET', '/platform/capabilities'],
  ['GET', '/platform/orgs'],
  ['GET', `/platform/orgs/${A}`],
  ['GET', '/platform/users'],
  ['GET', `/platform/users/${customer.id}`],
  ['POST', `/platform/users/${customer.id}/magic-link`],
  ['GET', '/platform/agencies'],
  ['GET', `/platform/agencies/${B}/clients`],
  ['GET', '/platform/jobs'],
  ['POST', `/platform/jobs/crawl/${crawl!.id}/cancel`],
  ['GET', '/platform/audit'],
  ['GET', '/platform/growth/snapshots'],
];
let all403 = true;
for (const [method, p] of ROUTES) {
  const r = await call(method, p, customerToken);
  if (r.status !== 403) {
    all403 = false;
    console.log(`        ${method} ${p} → ${r.status}`);
  }
}
check(`customer gets 403 on all ${ROUTES.length} Platform routes`, all403);
check('…and leaves no platform_access_events rows', (await accessEvents(customer.id)) === 0);

// ── 2–4. Support staff ───────────────────────────────────────────────────
await setRole(staff.id, 'support');
const staffToken = await tokenFor(staff);

// Warm the platform pool once (a cold Neon connect is not the route's
// latency, and /capabilities caches its live checks for 60s — so warm with a
// data route first, then let /capabilities take its checks on a warm pool).
await call('GET', '/platform/overview', staffToken);
await call('GET', '/platform/jobs?limit=1', staffToken);

const overview = await staffGet('GET /overview', '/platform/overview', staffToken, staff.id);
check(
  'overview: real org/user totals and the seeded stuck jobs are counted',
  overview?.organizations?.total >= 3 &&
    overview?.users?.total >= 2 &&
    overview?.stuckJobs?.byType?.crawl >= 1 &&
    overview?.stuckJobs?.byType?.agent_run >= 1 &&
    overview?.stuckJobs?.byType?.snapshot >= 1 &&
    typeof overview?.aiRuns?.today === 'number' &&
    overview?.leads !== null,
  overview,
);
// Latency: the guard chain (auth + two rate-limit upserts + role read +
// access-event insert) is shared with Phase 0's /platform/session, so the
// overview's own cost is measured against it — min of 3 interleaved samples.
const sessionMs: number[] = [];
const overviewMs: number[] = [];
for (let i = 0; i < 3; i++) {
  sessionMs.push((await call('GET', '/platform/session', staffToken)).ms);
  overviewMs.push((await call('GET', '/platform/overview', staffToken)).ms);
}
const sMin = Math.min(...sessionMs);
const oMin = Math.min(...overviewMs);
latencies.push({ route: 'GET /platform/session (guard-only baseline, min of 3)', ms: sMin, status: 200 });
latencies.push({ route: 'GET /platform/overview (min of 3)', ms: oMin, status: 200 });
check(`overview handler cost over the guard baseline < 1500ms (${oMin} - ${sMin} = ${oMin - sMin}ms)`, oMin - sMin < 1500);

const caps = await staffGet('GET /capabilities', '/platform/capabilities', staffToken, staff.id);
const capByKey = Object.fromEntries((caps?.capabilities ?? []).map((cap: any) => [cap.key, cap]));
check(
  'capabilities: ≥24 entries, every status in the vocabulary, every entry has dependencies[]',
  caps?.capabilities?.length >= 24 &&
    caps.capabilities.every((cap: any) => ['working', 'partial', 'blocked', 'stub'].includes(cap.status) && Array.isArray(cap.dependencies)),
  caps?.summary,
);
check(
  'capabilities: live facts — RLS working, platform view working, publishing/billing/cron stub, jobs partial',
  capByKey.tenant_isolation?.status === 'working' &&
    capByKey.platform_view?.status === 'working' &&
    capByKey.publishing?.status === 'stub' &&
    capByKey.billing?.status === 'stub' &&
    capByKey.scheduling?.status === 'stub' &&
    capByKey.background_jobs?.status === 'partial' &&
    capByKey.crm?.status === 'working',
  Object.fromEntries(Object.entries(capByKey).map(([k, v]: [string, any]) => [k, v.status])),
);
check(
  'capabilities: AI provider dependency reflects keys (no key ⇒ ai_visibility not working)',
  ['openai', 'anthropic', 'google', 'perplexity'].some((p) => !process.env[`${p.toUpperCase()}_API_KEY`])
    ? capByKey.ai_visibility?.status !== 'working'
    : true,
  capByKey.ai_visibility,
);

const orgList = await staffGet('GET /orgs?q=<stamp>', `/platform/orgs?q=${stamp}`, staffToken, staff.id);
const listedA = orgList?.items?.find((o: any) => o.id === A);
check(
  'orgs search finds the client org with plan, member count, brand and lastActivityAt',
  orgList?.total === 3 && listedA?.memberCount === 1 && listedA?.brand?.websiteUrl === 'https://pf-example.com' && typeof listedA?.lastActivityAt === 'string',
  orgList,
);
const likeEsc = await staffGet('GET /orgs?q=%_ (LIKE metachars escaped)', `/platform/orgs?q=${encodeURIComponent('%_%')}&limit=5`, staffToken, staff.id);
check('a "%_%" search matches literally (no wildcard explosion)', likeEsc?.total === 0, likeEsc?.total);
const capped = await staffGet('GET /orgs?limit=500', '/platform/orgs?limit=500', staffToken, staff.id);
check('limit=500 is clamped to 100', capped?.limit === 100 && capped?.items?.length <= 100, { limit: capped?.limit });
const kindFilter = await staffGet('GET /orgs?kind=agency&q=<stamp>', `/platform/orgs?kind=agency&q=${stamp}`, staffToken, staff.id);
check('kind=agency filter', kindFilter?.total === 1 && kindFilter.items[0].id === B, kindFilter);
const bad = await call('GET', '/platform/orgs?limit=abc', staffToken);
check('limit=abc → 422', bad.status === 422, bad);
const badKind = await call('GET', '/platform/orgs?kind=martian', staffToken);
check('kind=martian → 422', badKind.status === 422, badKind);

const beforeDetail = await accessEvents(staff.id);
const detail = await staffGet('GET /orgs/:id (cross-tenant)', `/platform/orgs/${A}`, staffToken, staff.id);
check(
  'org detail: staff (not a member) sees members, brand, plan limits, usage, runs and agency link',
  detail?.organization?.id === A &&
    detail.members.length === 1 &&
    detail.members[0].email === customer.email &&
    !detail.members.some((m: any) => m.userId === staff.id) &&
    detail.brand?.id === brand!.id &&
    detail.plan?.slug &&
    typeof detail.usage?.team_members?.used === 'number' &&
    detail.recentRuns.crawlJobs.some((j: any) => j.id === crawl!.id) &&
    detail.recentRuns.agentRuns.some((j: any) => j.id === agentRun!.id) &&
    detail.agencyLinks.asClient.length === 1 &&
    detail.agencyLinks.asClient[0].org.id === B,
  detail,
);
const [detailEvent] = await q(
  `select target_org_id, action from platform_access_events where user_id = $1 order by created_at desc limit 1`,
  [staff.id],
);
check(
  'org detail access event records target_org_id',
  detailEvent?.target_org_id === A && detailEvent?.action === 'GET /api/platform/orgs/:id' && (await accessEvents(staff.id)) === beforeDetail + 1,
  detailEvent,
);
const notUuid = await call('GET', '/platform/orgs/not-a-uuid', staffToken);
check('GET /orgs/not-a-uuid → 404', notUuid.status === 404, notUuid);
const unknown = await call('GET', `/platform/orgs/${randomUUID()}`, staffToken);
check('GET /orgs/<unknown uuid> → 404', unknown.status === 404, unknown);

const users = await staffGet('GET /users?q=<stamp>', `/platform/users?q=${stamp}`, staffToken, staff.id);
check('users search finds both seeded users', users?.total === 2, users);
const staffOnly = await staffGet('GET /users?platformRole=support&q=<stamp>', `/platform/users?platformRole=support&q=${stamp}`, staffToken, staff.id);
check('platformRole=support filter', staffOnly?.total === 1 && staffOnly.items[0].id === staff.id, staffOnly);
const userDetail = await staffGet('GET /users/:id', `/platform/users/${customer.id}`, staffToken, staff.id);
check(
  'user detail lists memberships with org kind',
  userDetail?.user?.id === customer.id &&
    userDetail.memberships.length === 2 &&
    userDetail.memberships.some((m: any) => m.organizationId === B && m.organizationKind === 'agency'),
  userDetail,
);

const agencies = await staffGet('GET /agencies?q=<stamp>', `/platform/agencies?q=${stamp}`, staffToken, staff.id);
check(
  'agencies lists the agency with client counts by status',
  agencies?.total === 1 && agencies.items[0].id === B && agencies.items[0].clientCounts.active === 1,
  agencies,
);
const clients = await staffGet('GET /agencies/:id/clients', `/platform/agencies/${B}/clients`, staffToken, staff.id);
check('agency clients lists the client org', clients?.total === 1 && clients.items[0].client.id === A, clients);

const jobs = await staffGet('GET /jobs?orgId=A', `/platform/jobs?orgId=${A}`, staffToken, staff.id);
check(
  'jobs (unified) lists the crawl and agent run for org A with org name, stuck=true',
  jobs?.total === 2 &&
    jobs.items.some((j: any) => j.type === 'crawl' && j.id === crawl!.id && j.stuck && j.organizationName === `PF Client ${stamp}`) &&
    jobs.items.some((j: any) => j.type === 'agent_run' && j.id === agentRun!.id && j.stuck),
  jobs,
);
const stuckJobs = await staffGet('GET /jobs?stuck=true&type=snapshot', '/platform/jobs?stuck=true&type=snapshot&limit=100', staffToken, staff.id);
check(
  'stuck=true&type=snapshot includes the seeded snapshot, all stuck',
  stuckJobs?.items?.some((j: any) => j.id === snapshot!.id) && stuckJobs.items.every((j: any) => j.stuck && j.type === 'snapshot'),
  stuckJobs?.total,
);
const badType = await call('GET', '/platform/jobs?type=cron', staffToken);
check('jobs type=cron → 422', badType.status === 422, badType);

const snaps = await staffGet('GET /growth/snapshots?status=processing', '/platform/growth/snapshots?status=processing&limit=100', staffToken, staff.id);
check('growth/snapshots lists the seeded processing snapshot', snaps?.items?.some((s: any) => s.id === snapshot!.id), snaps?.total);

const auditFeed = await staffGet('GET /audit?orgId=A', `/platform/audit?orgId=${A}`, staffToken, staff.id);
check(
  'audit feed shows the platform access event for org A (with actor email and org name)',
  auditFeed?.items?.some(
    (e: any) =>
      e.source === 'platform' &&
      e.action === 'GET /api/platform/orgs/:id' &&
      e.userId === staff.id &&
      e.userEmail === staff.email &&
      e.organizationName === `PF Client ${stamp}`,
  ),
  auditFeed?.items?.map((e: any) => `${e.source}:${e.action}`),
);
const platformOnly = await staffGet('GET /audit?source=platform&userId=staff', `/platform/audit?source=platform&userId=${staff.id}&limit=100`, staffToken, staff.id);
check(
  'audit source=platform&userId filter returns only that staff member’s access events',
  platformOnly?.total >= 15 && platformOnly.items.every((e: any) => e.source === 'platform' && e.userId === staff.id),
  platformOnly?.total,
);

// ── 5. Admin-only writes ─────────────────────────────────────────────────
const supportCancel = await call('POST', `/platform/jobs/crawl/${crawl!.id}/cancel`, staffToken);
check('support → cancel is 403 (admin only)', supportCancel.status === 403, supportCancel);
const supportLink = await call('POST', `/platform/users/${customer.id}/magic-link`, staffToken);
check('support → magic-link is 403 (admin only)', supportLink.status === 403, supportLink);

await setRole(staff.id, 'admin');

for (const [type, id, table, expected] of [
  ['crawl', crawl!.id, 'crawl_jobs', 'cancelled'],
  ['agent_run', agentRun!.id, 'agent_runs', 'failed'],
  ['snapshot', snapshot!.id, 'snapshot_requests', 'failed'],
] as const) {
  const before = await accessEvents(staff.id);
  const res = await call('POST', `/platform/jobs/${type}/${id}/cancel`, staffToken);
  latencies.push({ route: `POST /platform/jobs/${type}/:id/cancel`, ms: res.ms, status: res.status });
  check(`admin cancels stuck ${type} → 200 '${expected}'`, res.status === 200 && res.body?.status === expected, res);
  check(`…cancel wrote exactly one access event`, (await accessEvents(staff.id)) === before + 1);
  const [row] = await q(
    table === 'snapshot_requests'
      ? `select status::text, result_json->>'error' as error from snapshot_requests where id = $1`
      : `select status::text, error, completed_at from ${table} where id = $1`,
    [id],
  );
  check(
    `…${table} row is now '${expected}' with reason recorded`,
    row?.status === expected && row?.error === 'Cancelled by platform staff' && (table === 'snapshot_requests' || row?.completed_at !== null),
    row,
  );
  const [auditRow] = await q(
    `select organization_id, user_id, actor_role, old_value, new_value from audit_events
      where action = 'platform.job_cancelled' and entity_id = $1`,
    [id],
  );
  check(
    `…audit_events row written (org attribution ${type === 'snapshot' ? 'null' : 'A'})`,
    auditRow?.user_id === staff.id &&
      auditRow?.actor_role === 'platform_admin' &&
      auditRow?.organization_id === (type === 'snapshot' ? null : A),
    auditRow,
  );
  const again = await call('POST', `/platform/jobs/${type}/${id}/cancel`, staffToken);
  check(`…cancelling again → 409`, again.status === 409, again);
}
const auditAfter = await staffGet('GET /audit?orgId=A (after cancels)', `/platform/audit?orgId=${A}`, staffToken, staff.id);
check(
  'audit feed now merges app (platform.job_cancelled) and platform sources for org A',
  auditAfter?.items?.some((e: any) => e.source === 'app' && e.action === 'platform.job_cancelled' && e.entityId === crawl!.id) &&
    auditAfter.items.some((e: any) => e.source === 'platform'),
  auditAfter?.items?.map((e: any) => `${e.source}:${e.action}`),
);
const appOnly = await staffGet('GET /audit?source=app&action=job_cancel', '/platform/audit?source=app&action=job_cancel&limit=100', staffToken, staff.id);
check(
  'audit source=app&action filter',
  appOnly?.total >= 3 && appOnly.items.every((e: any) => e.source === 'app' && e.action.includes('job_cancel')),
  appOnly?.total,
);
const badCancel = await call('POST', `/platform/jobs/crawl/not-a-uuid/cancel`, staffToken);
check('cancel with malformed id → 404', badCancel.status === 404, badCancel);
const unknownCancel = await call('POST', `/platform/jobs/crawl/${randomUUID()}/cancel`, staffToken);
check('cancel unknown job → 404', unknownCancel.status === 404, unknownCancel);

const link = await call('POST', `/platform/users/${customer.id}/magic-link`, staffToken);
latencies.push({ route: 'POST /platform/users/:id/magic-link', ms: link.ms, status: link.status });
check(
  'admin sends a magic link → 200, no token/link in the body',
  link.status === 200 && link.body?.sent === true && !JSON.stringify(link.body).includes('token'),
  link,
);
const [tokens] = await q<{ n: number }>(
  `select count(*)::int n from magic_link_tokens where email = $1 and created_at > now() - interval '5 minutes'`,
  [customer.email],
);
check('…a magic_link_tokens row exists for that user', tokens!.n === 1, tokens);
const [linkAudit] = await q(
  `select user_id, entity_id from audit_events where action = 'platform.magic_link_sent' and entity_id = $1`,
  [customer.id],
);
check('…platform.magic_link_sent audit row', linkAudit?.user_id === staff.id, linkAudit);
const [linkEvent] = await q(
  `select target_user_id from platform_access_events where user_id = $1 and action = 'POST /api/platform/users/:id/magic-link'`,
  [staff.id],
);
check('…access event carries target_user_id', linkEvent?.target_user_id === customer.id, linkEvent);

// ── 6. CRM from the Platform view ────────────────────────────────────────
const staffInCustomerOrg = await tokenFor(staff, staffOwnOrg.body.id);
const crm = await call('GET', '/leads?limit=5', staffInCustomerOrg);
latencies.push({ route: 'GET /leads (staff, customer org selected)', ms: crm.ms, status: crm.status });
check('staff list CRM leads while their token selects a customer org (200)', crm.status === 200 && Array.isArray(crm.body?.data), crm);
const custCrm = await call('GET', '/leads?limit=5', await tokenFor(customer, A));
check('non-staff customer → GET /leads is 403', custCrm.status === 403, custCrm);
const custCrmDeals = await call('GET', '/deals', await tokenFor(customer, A));
check('non-staff customer → GET /deals is 403', custCrmDeals.status === 403, custCrmDeals);

// ── Teardown: never leave staff grants behind ────────────────────────────
await setRole(staff.id, 'none');
const revoked = await call('GET', '/platform/overview', staffToken);
check('after revoking, the same token gets 403', revoked.status === 403, revoked);

console.log('\nLatency (ms):');
for (const l of latencies) console.log(`  ${String(l.ms).padStart(6)}  ${l.status}  ${l.route}`);

await admin.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.label}`);
  process.exit(1);
}
process.exit(0);
