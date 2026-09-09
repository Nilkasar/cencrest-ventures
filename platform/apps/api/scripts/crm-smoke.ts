/**
 * End-to-end smoke test for the CRM, against a RUNNING API and a REAL
 * database. Real HTTP, real RS256 tokens, real rows.
 *
 *   pnpm --filter @bebest/api run smoke:crm
 *
 * Why this exists alongside 1,000 unit tests: those tests mock Prisma, so
 * they cannot see anything the database itself rejects. Three production
 * bugs got through them and were caught the first time this script ran:
 *
 *   1. `PATCH /deals/:id` spread camelCase request fields straight into
 *      Prisma's `data`, so any edit touching value/probability/close
 *      date/lost reason returned 500 ("Unknown argument `valueCents`").
 *   2. `POST /auth/magic-link/verify` wrote the literal string 'unknown'
 *      into `sessions.ip_address`, an INET column — every login 500'd
 *      unless a proxy happened to set X-Forwarded-For.
 *   3. A freshly verified access token carries no org claim and nothing
 *      selected one, so every org-scoped route answered 409 immediately
 *      after a successful login.
 *
 * Prerequisites: the API running (`pnpm --filter @bebest/api dev`),
 * `apps/api/.env` populated (DATABASE_URL, JWT keys, CRM_INTERNAL_ORG_ID),
 * and the dev seed applied (`pnpm --filter @bebest/api run seed:dev --
 * --samples`).
 *
 * Writes real rows. Point it at a development database, never production.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, importPKCS8 } from 'jose';
import { db, withOrgContext } from '@bebest/database';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

const envFile = path.join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API = process.env.SMOKE_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}/api`;
const ORG_ID = process.env.CRM_INTERNAL_ORG_ID;

if (!ORG_ID || !process.env.JWT_PRIVATE_KEY || !process.env.DATABASE_URL) {
  console.error(
    'Missing CRM_INTERNAL_ORG_ID, JWT_PRIVATE_KEY or DATABASE_URL — see apps/api/.env.',
  );
  process.exit(1);
}

// Staff come from the database rather than being hardcoded, so this runs
// against any seeded environment. Read through the same client the API
// uses — `memberships` has RLS keyed on `app.current_org`, so this goes
// through `withOrgContext` exactly as a route would.
const staff = await withOrgContext(ORG_ID, async (tx) => {
  const rows = await tx.memberships.findMany({
    where: { organization_id: ORG_ID },
    select: { user_id: true, role: true },
  });
  const users = await db.users.findMany({
    where: { id: { in: rows.map((row) => row.user_id) } },
    select: { id: true, email: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows
    .map((row) => {
      const user = byId.get(row.user_id);
      return user ? { id: user.id, email: user.email, role: String(row.role) } : null;
    })
    .filter((row): row is { id: string; email: string; role: string } => row !== null)
    .sort((a, b) => a.email.localeCompare(b.email));
});

const owner = staff.find((s) => s.role === 'owner');
const belowManage = staff.find((s) => s.role === 'member' || s.role === 'viewer');
if (!owner) {
  console.error('No owner in the internal ops org — run `pnpm --filter @bebest/api run seed:dev`.');
  process.exit(1);
}

const signingKey = await importPKCS8(process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
async function tokenFor(user, org = ORG_ID) {
  return new SignJWT({ email: user.email, org })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey);
}

const OWNER_TOKEN = await tokenFor(owner);
const LIMITED_TOKEN = belowManage ? await tokenFor(belowManage) : null;

const results = [];
async function call(label, method, urlPath, { token = OWNER_TOKEN, body, expect } = {}) {
  const started = performance.now();
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  const ok = expect === undefined ? res.ok : res.status === expect;
  results.push({ label, method, path: urlPath, status: res.status, ms, ok });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${String(res.status).padEnd(3)} ${String(ms).padStart(5)}ms  ${method} ${urlPath}  — ${label}`,
  );
  if (!ok) console.log('        body:', JSON.stringify(payload)?.slice(0, 300));
  return payload;
}

console.log(`=== CRM smoke against ${API} ===\n`);
const stamp = Date.now();

// ── Leads ────────────────────────────────────────────────────────────────
const leadList = await call('list leads', 'GET', '/leads?limit=100');
console.log(`        -> ${leadList.total} leads, counts ${JSON.stringify(leadList.statusCounts)}`);
await call('filter by status', 'GET', '/leads?status=new');
await call('filter by source', 'GET', '/leads?source=referral');
await call('server-side search', 'GET', '/leads?q=a');
await call('paginate', 'GET', '/leads?page=2&limit=5');
await call('reject an unknown status', 'GET', '/leads?status=bogus', { expect: 422 });

const lead = await call('create lead', 'POST', '/leads', {
  body: {
    email: `smoke-${stamp}@example.com`,
    name: 'Smoke Probe',
    company: 'Probe Co',
    website: 'https://example.com',
    source: 'direct',
    notes: 'created by smoke:crm',
  },
});
await call('read it back', 'GET', `/leads/${lead.id}`);
await call('404 for an unknown lead', 'GET', '/leads/00000000-0000-4000-8000-000000000000', {
  expect: 404,
});
await call('update status and score', 'PATCH', `/leads/${lead.id}`, {
  body: { status: 'contacted', score: 55 },
});
await call('refuse status=converted via PATCH', 'PATCH', `/leads/${lead.id}`, {
  body: { status: 'converted' },
  expect: 422,
});
await call('refuse a private-network website (SSRF guard)', 'POST', '/leads', {
  body: {
    email: `ssrf-${stamp}@example.com`,
    name: 'SSRF',
    website: 'http://169.254.169.254/latest',
    source: 'direct',
  },
  expect: 422,
});

// ── Conversion ───────────────────────────────────────────────────────────
const converted = await call('convert to an account', 'POST', `/leads/${lead.id}/convert`, {
  body: { organizationName: `Probe Co ${stamp}` },
});
if (converted?.lead?.status !== 'converted') {
  console.log('FAIL  convert response should carry the updated lead');
  results.push({ ok: false, label: 'convert returns lead', method: 'POST', path: '/convert', ms: 0 });
}
await call('refuse a second conversion', 'POST', `/leads/${lead.id}/convert`, {
  body: { organizationName: 'Probe Co again' },
  expect: 409,
});

// ── Deals ────────────────────────────────────────────────────────────────
const dealList = await call('list deals', 'GET', '/deals?limit=100');
console.log(`        -> ${dealList.total} deals`);
await call('filter by stage', 'GET', '/deals?stage=won');
await call('filter by lead', 'GET', `/deals?leadId=${lead.id}`);
await call('filter by account', 'GET', `/deals?accountOrganizationId=${converted.organizationId}`);
await call('search by title', 'GET', '/deals?q=smoke');

const deal = await call('create deal', 'POST', '/deals', {
  body: {
    title: `Smoke Deal ${stamp}`,
    valueCents: 1_234_500,
    currency: 'USD',
    stage: 'new',
    probability: 20,
    ownerId: owner.id,
    leadId: lead.id,
  },
});
await call('read it back', 'GET', `/deals/${deal.id}`);
// The regression that mattered: these fields all map to snake_case columns.
await call('edit value, probability, close date and reason', 'PATCH', `/deals/${deal.id}`, {
  body: {
    valueCents: 2_000_000,
    probability: 45,
    expectedCloseDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    lostReason: 'smoke',
  },
});
await call('refuse a stage change via PATCH', 'PATCH', `/deals/${deal.id}`, {
  body: { stage: 'won' },
  expect: 422,
});
await call('advance the stage', 'POST', `/deals/${deal.id}/stage`, { body: { stage: 'proposal' } });
await call('refuse lost without a reason', 'POST', `/deals/${deal.id}/stage`, {
  body: { stage: 'lost' },
  expect: 422,
});
await call('mark lost with a reason', 'POST', `/deals/${deal.id}/stage`, {
  body: { stage: 'lost', lostReason: 'smoke test' },
});

// ── Activities ───────────────────────────────────────────────────────────
await call('refuse a query with no parent', 'GET', '/activities', { expect: 422 });
await call('list for a lead', 'GET', `/activities?leadId=${lead.id}`);
await call('log a note', 'POST', '/activities', {
  body: { type: 'note', subject: 'Smoke note', body: 'logged by smoke:crm', leadId: lead.id },
});
await call('log a call on a deal', 'POST', '/activities', {
  body: { type: 'call', subject: 'Smoke call', dealId: deal.id },
});
await call('404 for an unknown parent', 'POST', '/activities', {
  body: { type: 'note', subject: 'x', leadId: '00000000-0000-4000-8000-000000000000' },
  expect: 404,
});

// ── Accounts ─────────────────────────────────────────────────────────────
const accounts = await call('list accounts', 'GET', '/accounts?limit=100');
console.log(`        -> ${accounts.total} accounts`);
await call('search accounts', 'GET', '/accounts?q=Probe');
await call('account detail', 'GET', `/accounts/${converted.organizationId}`);
await call('404 for an org that is not an account', 'GET', `/accounts/${ORG_ID}`, { expect: 404 });

// ── Staff roster ─────────────────────────────────────────────────────────
const roster = await call('staff roster', 'GET', '/crm/users');
console.log(`        -> ${roster.data.length} staff`);

// ── Response shape: names and links resolved server-side ────────────────
const firstDeal = (await call('deal carries owner and link', 'GET', '/deals?limit=1')).data[0];
if (firstDeal && !firstDeal.owner) {
  console.log('FAIL  deals must carry a resolved owner');
  results.push({ ok: false, label: 'deal.owner', method: 'GET', path: '/deals', ms: 0 });
}

// ── Authorization ────────────────────────────────────────────────────────
if (LIMITED_TOKEN) {
  await call('a member can read leads', 'GET', '/leads', { token: LIMITED_TOKEN });
  await call('a member cannot create one', 'POST', '/leads', {
    token: LIMITED_TOKEN,
    body: { email: `nope-${stamp}@example.com`, name: 'Nope', source: 'direct' },
    expect: 403,
  });
}
const otherOrgToken = await tokenFor(owner, converted.organizationId);
await call('403 when acting as a non-internal org', 'GET', '/leads', {
  token: otherOrgToken,
  expect: 403,
});

// ── Input the database would have rejected ───────────────────────────────
// Every case here returned a 500 before the field bounds were made to match
// the columns behind them (lib/crm-validation.ts).
const GHOST = '00000000-0000-4000-8000-000000000000';

await call('refuse an email longer than its column', 'POST', '/leads', {
  body: { email: `${'a'.repeat(250)}@example.com`, name: 'Long', source: 'direct' },
  expect: 422,
});
await call('refuse a website longer than its column', 'POST', '/leads', {
  body: {
    email: `long-${stamp}@example.com`,
    name: 'Long URL',
    website: `https://example.com/${'a'.repeat(600)}`,
    source: 'direct',
  },
  expect: 422,
});
await call('refuse a deal value beyond a 32-bit integer', 'POST', '/deals', {
  body: { title: 'Overflow', valueCents: 3_000_000_000, ownerId: owner.id },
  expect: 422,
});
await call('refuse an unsupported currency', 'POST', '/deals', {
  body: { title: 'Bad currency', valueCents: 1000, currency: 'ZZZ', ownerId: owner.id },
  expect: 422,
});
await call('refuse an owner who is not CRM staff', 'POST', '/deals', {
  body: { title: 'Bad owner', valueCents: 1000, ownerId: GHOST },
  expect: 422,
});
await call('refuse an account organization that does not exist', 'POST', '/deals', {
  body: { title: 'Bad account', valueCents: 1000, ownerId: owner.id, accountOrganizationId: GHOST },
  expect: 422,
});
await call('404 a malformed lead id rather than 500', 'GET', '/leads/not-a-uuid', { expect: 404 });
await call('404 a malformed deal id rather than 500', 'GET', '/deals/not-a-uuid', { expect: 404 });
await call('404 a malformed account id rather than 500', 'GET', '/accounts/not-a-uuid', { expect: 404 });
await call('refuse an organization name that slugifies to nothing', 'POST', `/leads/${lead.id}/convert`, {
  body: { organizationName: '!!!' },
  expect: 422,
});

// ── Behaviour that only concurrency reveals ──────────────────────────────
{
  const racer = await call('lead for the conversion race', 'POST', '/leads', {
    body: {
      email: `race-${stamp}@example.com`,
      name: 'Race Probe',
      company: `Race Co ${stamp}`,
      source: 'direct',
    },
    expect: 201,
  });

  // Under READ COMMITTED both requests once read `converted_organization_id`
  // as null and both created an organization — two accounts for one lead.
  // The handler now takes a FOR UPDATE row lock.
  const [first, second] = await Promise.all([
    fetch(`${API}/leads/${racer.id}/convert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationName: `Race A ${stamp}` }),
    }),
    fetch(`${API}/leads/${racer.id}/convert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationName: `Race B ${stamp}` }),
    }),
  ]);
  const statuses = [first.status, second.status].sort();
  const raceOk = statuses[0] === 200 && statuses[1] === 409;
  results.push({
    label: 'exactly one of two simultaneous conversions wins',
    method: 'POST',
    path: '/leads/:id/convert',
    status: Number(statuses[1]),
    ms: 0,
    ok: raceOk,
  });
  console.log(
    `${raceOk ? 'PASS' : 'FAIL'}  ${statuses.join('/')}          POST /leads/:id/convert ×2  — exactly one wins`,
  );
}

// ── Data that should not contradict itself ───────────────────────────────
{
  const d = await call('deal for the lost-reason check', 'POST', '/deals', {
    body: { title: `Reason ${stamp}`, valueCents: 1000, ownerId: owner.id },
    expect: 201,
  });
  await call('move it to lost with a reason', 'POST', `/deals/${d.id}/stage`, {
    body: { stage: 'lost', lostReason: 'budget' },
    expect: 200,
  });
  const won = await call('move it back to won', 'POST', `/deals/${d.id}/stage`, {
    body: { stage: 'won' },
    expect: 200,
  });
  const cleared = won?.lostReason === null;
  results.push({
    label: 'a won deal carries no lost reason',
    method: 'POST',
    path: '/deals/:id/stage',
    status: 200,
    ms: 0,
    ok: cleared,
  });
  console.log(`${cleared ? 'PASS' : 'FAIL'}  lostReason cleared on leaving the lost stage`);
}

// ── Search is searched, not interpreted ──────────────────────────────────
{
  const all = await call('total leads', 'GET', '/leads?limit=1', { expect: 200 });
  const wildcard = await call('a bare % is not a wildcard', 'GET', `/leads?q=${encodeURIComponent('%')}`, {
    expect: 200,
  });
  const escaped = wildcard.total < all.total;
  results.push({
    label: 'LIKE metacharacters are escaped',
    method: 'GET',
    path: '/leads?q=%',
    status: 200,
    ms: 0,
    ok: escaped,
  });
  console.log(
    `${escaped ? 'PASS' : 'FAIL'}  "%" matched ${wildcard.total} of ${all.total} — not the whole table`,
  );
}

// ── Summary ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const times = results.map((r) => r.ms).filter(Boolean).sort((a, b) => a - b);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => `${f.method} ${f.path} (${f.status})`).join(', '));
}
console.log('\nSlowest:');
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)) {
  console.log(`  ${String(r.ms).padStart(5)}ms  ${r.method} ${r.path}`);
}
console.log(
  `\nmedian=${times[Math.floor(times.length / 2)]}ms  p95=${times[Math.floor(times.length * 0.95)]}ms`,
);
process.exit(failed.length ? 1 : 0);
