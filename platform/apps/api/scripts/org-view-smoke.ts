/**
 * End-to-end smoke test for Epic 22 Phase 2 (Organization view) against a
 * RUNNING API and a REAL database. Real HTTP, real RS256 tokens, real rows.
 *
 *   pnpm --filter @bebest/api run smoke:org
 *
 * Walks the Phase 2 end-to-end flow in platform/docs/epics/22-workspace-views.md:
 *   A. Two users whose email prefix is "john" both get their own org on first
 *      login (unique slugs, no 409), concurrent creates of one name never
 *      collide, strict mode still 409s.
 *   B. Onboarding completion on the server: 404 without a brand, 422 with the
 *      missing steps, then 200 → a real crawl_jobs row + an ACTIVE query set;
 *      a second call is idempotent; two concurrent calls start exactly one of
 *      each; /auth/me's needsOnboarding flips; skip reason without a website.
 *   C. Invitations: invite → public preview → wrong user rejected → right user
 *      accepts → member → select-org works → inviter notified in-app; accept
 *      twice 409; expired 410; existing member 200 alreadyMember.
 *   D. Notification preferences: saved, read back, RLS-scoped to the org, and
 *      HONOURED by notify(): email off → no email row; in-app off → no in-app row.
 *   E. Autonomy: default 3 (effective = min(org, plan)), owner/admin only,
 *      plan-capped, level 4 rejected; after lowering it, an agent trigger
 *      above the org ceiling is 422 and creates no agent_runs row.
 *   F. Rename: admin renames → /auth/me shows it → audit row with old/new;
 *      analyst 403; slug change 422.
 *   G. Delete: analyst 403; wrong confirmation 422; right one → org gone from
 *      /auth/me (owner AND member), select-org 404, old token 403, pending
 *      invite links dead, audit row written.
 *
 * Prerequisites: the API running (`SMOKE_API_URL`, default
 * http://localhost:$PORT/api), apps/api/.env (DATABASE_URL as bebest_app,
 * JWT keys), migration 0024 applied, plans seeded (`seed:plans`).
 *
 * Invitation tokens: the dev API's EmailSender is the console one, so the
 * raw token of an HTTP-created invite is not observable from here. After the
 * real `POST /orgs/:slug/invitations` call, this script re-points that row's
 * `token_hash` at a token it knows (owner connection). Everything after that
 * — preview, accept, select-org — is the real HTTP path.
 *
 * Writes real rows (users, orgs, brands, a crawl job, query sets,
 * notifications). Point it at a development database, never production.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
if (!process.env.JWT_PRIVATE_KEY || !process.env.DATABASE_URL || !ADMIN_URL) {
  console.error('Missing JWT_PRIVATE_KEY / DATABASE_URL (apps/api/.env) or an admin database URL.');
  process.exit(1);
}

const admin = new pg.Client({
  connectionString: ADMIN_URL,
  ssl: ADMIN_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await admin.connect();

// Imported only after apps/api/.env is loaded, so `db` is the APP role.
const { db, withOrgContext } = await import('@bebest/database');
const [appRole] = await db.$queryRaw<{ rolname: string; bypass: boolean }[]>`
  SELECT rolname::text AS rolname, (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user
`;
console.log(`app connection role: ${appRole?.rolname} (bypasses RLS: ${appRole?.bypass})`);
if (!appRole || appRole.bypass) {
  console.error('The app DATABASE_URL must be a role that cannot bypass RLS (bebest_app).');
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

const results: { label: string; ok: boolean }[] = [];
function check(label: string, ok: boolean, detail?: unknown): void {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail !== undefined) console.log('        got:', JSON.stringify(detail)?.slice(0, 500));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
async function call(method: string, urlPath: string, token: string | null, body?: unknown): Promise<{ status: number; body: Body }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await admin.query(sql, params)).rows as T[];
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await q<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? -1);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const stamp = Date.now();

async function makeUser(email: string, name: string) {
  return db.users.create({ data: { email, name, email_verified: true } });
}

async function selectOrg(user: { id: string; email: string }, slug: string): Promise<string> {
  const res = await call('POST', '/auth/select-org', await tokenFor(user), { slug });
  if (res.status !== 200) throw new Error(`select-org ${slug} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Invite via the real route, then re-point the row at a token we know. */
async function invite(
  orgSlug: string,
  inviterToken: string,
  email: string,
  role: string,
): Promise<{ token: string; status: number }> {
  const res = await call('POST', `/orgs/${orgSlug}/invitations`, inviterToken, { email, role });
  if (res.status !== 201) return { token: '', status: res.status };
  const token = randomBytes(32).toString('hex');
  const updated = await q(
    `UPDATE invitations SET token_hash = $1
      WHERE id = (SELECT i.id FROM invitations i JOIN organizations o ON o.id = i.organization_id
                   WHERE o.slug = $2 AND i.email = $3 AND i.accepted_at IS NULL
                   ORDER BY i.created_at DESC LIMIT 1)
      RETURNING id`,
    [sha256(token), orgSlug, email],
  );
  if (updated.length !== 1) throw new Error('could not locate the invitation row just created');
  return { token, status: res.status };
}

console.log(`=== Organization view (Epic 22 Phase 2) smoke against ${API} ===\n`);

// ── A. Unique slugs on first login ───────────────────────────────────────
console.log('— A. unique org slugs');
const johnA = await makeUser(`john@a${stamp}.example`, 'john');
const johnB = await makeUser(`john@b${stamp}.example`, 'john');
const tJohnA = await tokenFor(johnA);
const tJohnB = await tokenFor(johnB);

// What the web does on first login: name = email prefix.
const orgA = await call('POST', '/orgs', tJohnA, { name: 'john' });
const orgB = await call('POST', '/orgs', tJohnB, { name: 'john' });
check('john@a… gets an org (201)', orgA.status === 201, orgA);
check('john@b… ALSO gets an org (201, not 409)', orgB.status === 201, orgB);
const slugA: string = orgA.body?.slug;
const slugB: string = orgB.body?.slug;
check(
  'both slugs are john / john-N and distinct',
  /^john(-\d+)?$/.test(slugA) && /^john(-\d+)?$/.test(slugB) && slugA !== slugB,
  { slugA, slugB },
);

const strict = await call('POST', '/orgs', tJohnB, { name: 'john', slug: slugA, strictSlug: true });
check('strictSlug on a taken slug → 409 slug_taken', strict.status === 409 && strict.body?.code === 'slug_taken', strict);
check('…and created no org', (await count('SELECT count(*)::int n FROM organizations WHERE created_by = $1', [johnB.id])) === 1);

const reserved = await call('POST', '/orgs', tJohnB, { name: 'Me' });
check('a name slugifying to a reserved word gets a suffix (me → me-N)', reserved.status === 201 && /^me-\d+$/.test(reserved.body?.slug), reserved);

const racers = await Promise.all([0, 1, 2].map((i) => makeUser(`race${i}-${stamp}@example.com`, `Racer ${i}`)));
const raceName = `Race ${stamp}`;
const raced = await Promise.all(racers.map(async (u) => call('POST', '/orgs', await tokenFor(u), { name: raceName })));
const racedSlugs = raced.map((r) => r.body?.slug as string);
check('3 concurrent creates of one name → all 201', raced.every((r) => r.status === 201), raced.map((r) => r.status));
check('…with 3 distinct slugs', new Set(racedSlugs).size === 3, racedSlugs);
check(
  '…each with exactly one owner membership',
  (await count(
    `SELECT count(*)::int n FROM memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE o.slug = ANY($1) AND m.role = 'owner'`,
    [racedSlugs],
  )) === 3,
);
check(
  'organization.created audited for each org',
  (await count(
    `SELECT count(*)::int n FROM audit_events WHERE action = 'organization.created' AND organization_id = ANY($1::uuid[])`,
    [[orgA.body?.id, orgB.body?.id]],
  )) === 2,
);

// ── B. Onboarding on the server ──────────────────────────────────────────
console.log('\n— B. onboarding completion');
let tA = await selectOrg(johnA, slugA);
let meA = await call('GET', '/auth/me', tA);
let meOrgA = meA.body?.organizations?.find((o: Body) => o.slug === slugA);
check('/auth/me before a brand: needsOnboarding true, hasBrand false', meOrgA?.needsOnboarding === true && meOrgA?.hasBrand === false, meOrgA);

const noBrand = await call('POST', '/brands/me/onboarding/complete', tA);
check('complete without a brand → 404', noBrand.status === 404, noBrand);

const brandA = await call('PATCH', '/brands/me', tA, {
  name: `John A ${stamp}`,
  websiteUrl: 'https://example.com',
  industries: ['Software'],
  categories: ['Analytics'],
});
check('brand created (201)', brandA.status === 201, brandA);
check('GET /brands/me exposes onboardingCompletedAt: null', (await call('GET', '/brands/me', tA)).body?.onboardingCompletedAt === null);

const incomplete = await call('POST', '/brands/me/onboarding/complete', tA);
check(
  'complete with no competitors / use cases → 422 listing exactly those steps',
  incomplete.status === 422 &&
    JSON.stringify(incomplete.body?.missing) === JSON.stringify(['competitors', 'use-cases']),
  incomplete,
);

await call('POST', '/brands/me/competitors', tA, { name: `Rival ${stamp}` });
for (let i = 1; i <= 2; i += 1) await call('POST', '/brands/me/use-cases', tA, { title: `Use case ${i}` });
const twoUseCases = await call('POST', '/brands/me/onboarding/complete', tA);
check('only 2 use cases → still 422 [use-cases] (the wizard minimum is 3)', twoUseCases.status === 422 && JSON.stringify(twoUseCases.body?.missing) === '["use-cases"]', twoUseCases);
await call('POST', '/brands/me/use-cases', tA, { title: 'Use case 3' });

const brandRow = (await q<{ id: string }>('SELECT id FROM brands WHERE organization_id = $1', [orgA.body.id]))[0]!;
const done = await call('POST', '/brands/me/onboarding/complete', tA);
check('complete → 200, alreadyCompleted false', done.status === 200 && done.body?.alreadyCompleted === false, done);
check('crawl started with a jobId', done.body?.crawl?.status === 'started' && typeof done.body?.crawl?.jobId === 'string', done.body?.crawl);
check('query set created with an id', done.body?.querySet?.status === 'created' && typeof done.body?.querySet?.id === 'string', done.body?.querySet);
check(
  'a real crawl_jobs row exists for the brand (that jobId)',
  (await count('SELECT count(*)::int n FROM crawl_jobs WHERE id = $1 AND brand_id = $2', [done.body?.crawl?.jobId, brandRow.id])) === 1,
);
check(
  'an ACTIVE query set exists for the brand (that id), with queries',
  (await count(
    `SELECT count(*)::int n FROM query_sets qs WHERE qs.id = $1 AND qs.brand_id = $2 AND qs.status = 'active'
        AND (SELECT count(*) FROM queries WHERE query_set_id = qs.id) > 0`,
    [done.body?.querySet?.id, brandRow.id],
  )) === 1,
);
check(
  'brands.onboarding_completed_at is set in the database',
  (await count('SELECT count(*)::int n FROM brands WHERE id = $1 AND onboarding_completed_at IS NOT NULL', [brandRow.id])) === 1,
);

const again = await call('POST', '/brands/me/onboarding/complete', tA);
check(
  'second call → 200 alreadyCompleted, same completedAt, reports the same crawl + query set',
  again.status === 200 &&
    again.body?.alreadyCompleted === true &&
    again.body?.completedAt === done.body?.completedAt &&
    again.body?.crawl?.jobId === done.body?.crawl?.jobId &&
    again.body?.querySet?.id === done.body?.querySet?.id,
  again.body,
);
check('…no second crawl job', (await count('SELECT count(*)::int n FROM crawl_jobs WHERE brand_id = $1', [brandRow.id])) === 1);
check('…no second query set', (await count('SELECT count(*)::int n FROM query_sets WHERE brand_id = $1', [brandRow.id])) === 1);
check(
  'onboarding.completed audited once',
  (await count(`SELECT count(*)::int n FROM audit_events WHERE action = 'onboarding.completed' AND organization_id = $1`, [orgA.body.id])) === 1,
);

meA = await call('GET', '/auth/me', tA);
meOrgA = meA.body?.organizations?.find((o: Body) => o.slug === slugA);
check('"another device": /auth/me now says needsOnboarding false + onboardingCompletedAt', meOrgA?.needsOnboarding === false && meOrgA?.onboardingCompletedAt === done.body?.completedAt, meOrgA);
check('GET /brands/me shows the same completion time', (await call('GET', '/brands/me', tA)).body?.onboardingCompletedAt === done.body?.completedAt);

// Org B: no website, and two concurrent "Done" clicks.
const tB = await selectOrg(johnB, slugB);
await call('PATCH', '/brands/me', tB, { name: `John B ${stamp}`, industries: ['Retail'] });
await call('POST', '/brands/me/competitors', tB, { name: `Rival B ${stamp}` });
for (let i = 1; i <= 3; i += 1) await call('POST', '/brands/me/use-cases', tB, { title: `B use case ${i}` });
const [c1, c2] = await Promise.all([
  call('POST', '/brands/me/onboarding/complete', tB),
  call('POST', '/brands/me/onboarding/complete', tB),
]);
check('two concurrent completes → both 200', c1.status === 200 && c2.status === 200, [c1, c2]);
check('…exactly one of them did the first completion', [c1, c2].filter((r) => r.body?.alreadyCompleted === false).length === 1, [c1.body, c2.body]);
const firstB = [c1, c2].find((r) => r.body?.alreadyCompleted === false)!;
check('no website → crawl skipped with reason no_website_url', firstB.body?.crawl?.status === 'skipped' && firstB.body?.crawl?.reason === 'no_website_url', firstB.body?.crawl);
const brandB = (await q<{ id: string }>('SELECT id FROM brands WHERE organization_id = $1', [orgB.body.id]))[0]!;
check('…exactly one query set for org B', (await count('SELECT count(*)::int n FROM query_sets WHERE brand_id = $1', [brandB.id])) === 1);
check('…and no crawl job for org B', (await count('SELECT count(*)::int n FROM crawl_jobs WHERE brand_id = $1', [brandB.id])) === 0);

// ── C. Invitations ───────────────────────────────────────────────────────
console.log('\n— C. invitations');
const teammate = await makeUser(`teammate-${stamp}@example.com`, 'Tia Teammate');
const wrongUser = await makeUser(`wrong-${stamp}@example.com`, 'Wes Wrong');

const inv1 = await invite(slugA, tA, teammate.email, 'analyst');
check('owner invites a teammate (201)', inv1.status === 201);

const preview = await call('GET', `/orgs/invitations/preview?token=${inv1.token}`, null);
check(
  'PUBLIC preview (no token) → org, inviter, role, masked email, not expired/accepted',
  preview.status === 200 &&
    preview.body?.organizationName === 'john' &&
    preview.body?.inviterName === 'john' &&
    preview.body?.role === 'analyst' &&
    preview.body?.email === `t***@example.com` &&
    preview.body?.expired === false &&
    preview.body?.accepted === false,
  preview,
);
check('preview exposes nothing else', Object.keys(preview.body ?? {}).sort().join(',') === 'accepted,email,expired,inviterName,organizationName,role', preview.body);
const unknown = await call('GET', `/orgs/invitations/preview?token=${randomBytes(32).toString('hex')}`, null);
check('unknown token → 404 generic (no org name)', unknown.status === 404 && !JSON.stringify(unknown.body).includes('john'), unknown);

const wrong = await call('POST', '/orgs/invitations/accept', await tokenFor(wrongUser), { token: inv1.token });
check('wrong signed-in user → 403 email_mismatch', wrong.status === 403 && wrong.body?.code === 'email_mismatch', wrong);
check('…and the invitation is still unaccepted', (await call('GET', `/orgs/invitations/preview?token=${inv1.token}`, null)).body?.accepted === false);

const tTeammate = await tokenFor(teammate);
const accepted = await call('POST', '/orgs/invitations/accept', tTeammate, { token: inv1.token });
check(
  'invited user accepts → 200 with the org slug, role analyst',
  accepted.status === 200 && accepted.body?.organizationSlug === slugA && accepted.body?.role === 'analyst' && accepted.body?.alreadyMember === false,
  accepted,
);
check(
  'membership row exists at analyst',
  (await count(`SELECT count(*)::int n FROM memberships WHERE organization_id = $1 AND user_id = $2 AND role = 'analyst'`, [orgA.body.id, teammate.id])) === 1,
);
const tTeammateA = await selectOrg(teammate, slugA).catch(() => '');
check('select-org for that org now succeeds', tTeammateA !== '');
const teammateMe = await call('GET', '/auth/me', tTeammate);
check('teammate /auth/me lists the org (needsOnboarding false — onboarding is org-wide)', teammateMe.body?.organizations?.some((o: Body) => o.slug === slugA && o.needsOnboarding === false), teammateMe.body);

const inviterNotes = await call('GET', '/notifications', tA);
check(
  'inviter sees an invitation_accepted notification in-app',
  inviterNotes.body?.items?.some((n: Body) => n.type === 'invitation_accepted' && n.channel === 'in_app'),
  inviterNotes.body?.items?.map((n: Body) => n.type),
);
check(
  '…and (default preferences) an email-channel row was written for the inviter',
  (await count(`SELECT count(*)::int n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND type = 'invitation_accepted' AND channel = 'email'`, [orgA.body.id, johnA.id])) === 1,
);
check(
  'invitation.accepted audited',
  (await count(`SELECT count(*)::int n FROM audit_events WHERE action = 'invitation.accepted' AND organization_id = $1`, [orgA.body.id])) === 1,
);

const twice = await call('POST', '/orgs/invitations/accept', tTeammate, { token: inv1.token });
check('accepting the same invitation again → 409 already_accepted', twice.status === 409 && twice.body?.code === 'already_accepted', twice);
check('preview now reports accepted: true', (await call('GET', `/orgs/invitations/preview?token=${inv1.token}`, null)).body?.accepted === true);

const invExpired = await invite(slugA, tA, wrongUser.email, 'viewer');
await q(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256(invExpired.token)]);
const expired = await call('POST', '/orgs/invitations/accept', await tokenFor(wrongUser), { token: invExpired.token });
check('expired invitation → 410 expired', expired.status === 410 && expired.body?.code === 'expired', expired);
check('preview reports expired: true', (await call('GET', `/orgs/invitations/preview?token=${invExpired.token}`, null)).body?.expired === true);

const invMember = await invite(slugA, tA, teammate.email, 'viewer');
const asMember = await call('POST', '/orgs/invitations/accept', tTeammate, { token: invMember.token });
check(
  'an existing member accepting → 200 alreadyMember, role NOT downgraded',
  asMember.status === 200 && asMember.body?.alreadyMember === true && asMember.body?.role === 'analyst',
  asMember,
);

const noAuthAccept = await call('POST', '/orgs/invitations/accept', null, { token: invMember.token });
check('accept without auth → 401', noAuthAccept.status === 401, noAuthAccept);

// ── D. Notification preferences ──────────────────────────────────────────
console.log('\n— D. notification preferences');
const prefs0 = await call('GET', '/orgs/me/notification-preferences', tA);
check(
  'defaults: every emitted type, both channels on',
  prefs0.status === 200 && prefs0.body?.preferences?.length === 5 && prefs0.body.preferences.every((p: Body) => p.inApp && p.email),
  prefs0,
);
const put1 = await call('PUT', '/orgs/me/notification-preferences', tA, {
  preferences: [{ eventType: 'invitation_accepted', email: false }],
});
check('PUT email off for invitation_accepted → 200', put1.status === 200, put1);
const prefs1 = await call('GET', '/orgs/me/notification-preferences', tA);
const ia1 = prefs1.body?.preferences?.find((p: Body) => p.eventType === 'invitation_accepted');
check('read back: inApp true, email false', ia1?.inApp === true && ia1?.email === false, ia1);

const prefsOtherOrg = await call('GET', '/orgs/me/notification-preferences', await selectOrg(johnA, (await call('POST', '/orgs', tJohnA, { name: `John Second ${stamp}` })).body.slug));
check('same user, another org → still defaults (preferences are per org)', prefsOtherOrg.body?.preferences?.every((p: Body) => p.email), prefsOtherOrg.body);

const rlsOwn = await withOrgContext(orgA.body.id, (tx) => tx.notification_preferences.count({ where: { user_id: johnA.id } }));
const rlsOther = await withOrgContext(orgB.body.id, (tx) => tx.notification_preferences.count({ where: { user_id: johnA.id } }));
check(`RLS: bebest_app sees the row under org A's context (${rlsOwn}) and nothing under org B's (${rlsOther})`, rlsOwn === 1 && rlsOther === 0);

const emailRowsBefore = await count(
  `SELECT count(*)::int n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND type = 'invitation_accepted' AND channel = 'email'`,
  [orgA.body.id, johnA.id],
);
const joiner2 = await makeUser(`joiner2-${stamp}@example.com`, 'Jo Joiner');
const inv2 = await invite(slugA, tA, joiner2.email, 'viewer');
const acc2 = await call('POST', '/orgs/invitations/accept', await tokenFor(joiner2), { token: inv2.token });
check('second teammate accepts (200)', acc2.status === 200, acc2);
check(
  'email OFF is honoured: no new email row for the inviter',
  (await count(
    `SELECT count(*)::int n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND type = 'invitation_accepted' AND channel = 'email'`,
    [orgA.body.id, johnA.id],
  )) === emailRowsBefore,
);
check(
  '…while the in-app row WAS written',
  (await count(`SELECT count(*)::int n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND type = 'invitation_accepted' AND channel = 'in_app'`, [orgA.body.id, johnA.id])) === 2,
);

await call('PUT', '/orgs/me/notification-preferences', tA, { preferences: [{ eventType: 'invitation_accepted', inApp: false }] });
const joiner3 = await makeUser(`joiner3-${stamp}@example.com`, 'Jay Joiner');
const inv3 = await invite(slugA, tA, joiner3.email, 'viewer');
await call('POST', '/orgs/invitations/accept', await tokenFor(joiner3), { token: inv3.token });
check(
  'in-app OFF is honoured: still 2 in-app rows after a third accept',
  (await count(`SELECT count(*)::int n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND type = 'invitation_accepted' AND channel = 'in_app'`, [orgA.body.id, johnA.id])) === 2,
);
const badPut = await call('PUT', '/orgs/me/notification-preferences', tA, { preferences: [{ eventType: 'billing_alert', email: false }] });
check('PUT for a type nothing emits → 422', badPut.status === 422, badPut);

// ── E. Autonomy ──────────────────────────────────────────────────────────
console.log('\n— E. autonomy');
// Default org ceiling is 3 (migration 0025): behaviour before Phase 2 is
// preserved, the effective ceiling is min(org setting, plan cap).
const auto0 = await call('GET', '/orgs/me/autonomy', tA);
check(
  'default org autonomy level is 3 (free plan: no plan cap → effectiveMax 3)',
  auto0.status === 200 && auto0.body?.level === 3 && auto0.body?.effectiveMax === 3,
  auto0,
);
check(
  'a new org row gets 3 from the column default',
  (await count('SELECT autonomy_level_max::int n FROM organizations WHERE id = $1', [orgB.body.id])) === 3,
);
const upgrade = await call('POST', '/orgs/me/subscription/upgrade', tA, { planSlug: 'pro' });
check('owner upgrades to pro (agents, autonomy_level_max 3)', upgrade.status === 200, upgrade);
const auto1 = await call('GET', '/orgs/me/autonomy', tA);
check(
  'autonomy now reports planMax 3, maxAllowed 3, effectiveMax 3, agentsAvailable',
  auto1.body?.planMax === 3 && auto1.body?.maxAllowed === 3 && auto1.body?.effectiveMax === 3 && auto1.body?.agentsAvailable === true,
  auto1.body,
);

const l4 = await call('PUT', '/orgs/me/autonomy', tA, { level: 4 });
check('PUT level 4 → 422 (hard block)', l4.status === 422, l4);
const asAnalyst = await call('PUT', '/orgs/me/autonomy', tTeammateA, { level: 2 });
check('analyst PUT → 403', asAnalyst.status === 403, asAnalyst);
check('analyst GET → 200 canEdit false', (await call('GET', '/orgs/me/autonomy', tTeammateA)).body?.canEdit === false);

const runsBefore = await count('SELECT count(*)::int n FROM agent_runs WHERE organization_id = $1', [orgA.body.id]);
const l4Run = await call('POST', '/brands/me/agents/geo_agent/run', tA, { autonomyLevel: 4 });
check('agent trigger at level 4 with org ceiling 3 → 422 (hard block, not the org cap)', l4Run.status === 422 && l4Run.body?.code === undefined, l4Run);

const set1 = await call('PUT', '/orgs/me/autonomy', tA, { level: 1 });
check('owner lowers the ceiling to 1 → 200 (effectiveMax 1)', set1.status === 200 && set1.body?.level === 1 && set1.body?.effectiveMax === 1, set1);
check(
  'settings.changed audited with old 3 → new 1',
  (await count(
    `SELECT count(*)::int n FROM audit_events WHERE organization_id = $1 AND action = 'settings.changed'
        AND old_value->>'autonomyLevelMax' = '3' AND new_value->>'autonomyLevelMax' = '1'`,
    [orgA.body.id],
  )) === 1,
);
const above = await call('POST', '/brands/me/agents/geo_agent/run', tA, { autonomyLevel: 2 });
check(
  'agent trigger at level 2 with org ceiling 1 → 422 above_org_autonomy_limit (limit 1)',
  above.status === 422 && above.body?.code === 'above_org_autonomy_limit' && above.body?.limit === 1,
  above,
);
check('…and no agent_runs row was created', (await count('SELECT count(*)::int n FROM agent_runs WHERE organization_id = $1', [orgA.body.id])) === runsBefore);

const set2 = await call('PUT', '/orgs/me/autonomy', tA, { level: 2 });
check('owner raises the ceiling to 2 → 200', set2.status === 200 && set2.body?.level === 2, set2);
const above3 = await call('POST', '/brands/me/agents/geo_agent/run', tA, { autonomyLevel: 3 });
check('agent trigger at level 3 with ceiling 2 → 422 (limit 2)', above3.status === 422 && above3.body?.limit === 2, above3);
await call('PUT', '/orgs/me/autonomy', tA, { level: 3 });
check('DB value is back to 3', (await count('SELECT autonomy_level_max::int n FROM organizations WHERE id = $1', [orgA.body.id])) === 3);

// ── F. Rename ────────────────────────────────────────────────────────────
console.log('\n— F. rename');
const renameAnalyst = await call('PATCH', `/orgs/${slugA}`, tTeammate, { name: 'Analyst Rename' });
check('analyst rename → 403', renameAnalyst.status === 403, renameAnalyst);
const slugChange = await call('PATCH', `/orgs/${slugA}`, tA, { name: 'John Renamed', slug: 'new-slug' });
check('slug change → 422 slug_immutable', slugChange.status === 422 && slugChange.body?.error === 'slug_immutable', slugChange);
const renamed = await call('PATCH', `/orgs/${slugA}`, tA, { name: `John Renamed ${stamp}` });
check('owner renames → 200, slug unchanged', renamed.status === 200 && renamed.body?.slug === slugA && renamed.body?.name === `John Renamed ${stamp}`, renamed);
const meRenamed = await call('GET', '/auth/me', tTeammate);
check('/auth/me (another member) shows the new name', meRenamed.body?.organizations?.some((o: Body) => o.slug === slugA && o.name === `John Renamed ${stamp}`), meRenamed.body?.organizations);
check(
  'rename audited with old → new name',
  (await count(
    `SELECT count(*)::int n FROM audit_events WHERE organization_id = $1 AND action = 'settings.changed'
        AND old_value->>'name' = 'john' AND new_value->>'name' = $2`,
    [orgA.body.id, `John Renamed ${stamp}`],
  )) === 1,
);

// ── G. Delete ────────────────────────────────────────────────────────────
console.log('\n— G. delete');
const pending = await invite(slugA, tA, `pending-${stamp}@example.com`, 'viewer');
check('a pending invitation exists before delete (preview 200)', (await call('GET', `/orgs/invitations/preview?token=${pending.token}`, null)).status === 200);

const delAnalyst = await call('DELETE', `/orgs/${slugA}`, tTeammate, { confirmName: `John Renamed ${stamp}` });
check('analyst delete → 403', delAnalyst.status === 403, delAnalyst);
const delWrong = await call('DELETE', `/orgs/${slugA}`, tA, { confirmName: 'john' });
check('owner delete with the wrong confirmation → 422 confirmation_mismatch', delWrong.status === 422 && delWrong.body?.error === 'confirmation_mismatch', delWrong);
const delNone = await call('DELETE', `/orgs/${slugA}`, tA);
check('owner delete with no body → 422', delNone.status === 422, delNone);
check('…org still listed in /auth/me', (await call('GET', '/auth/me', tJohnA)).body?.organizations?.some((o: Body) => o.slug === slugA));

const del = await call('DELETE', `/orgs/${slugA}`, tA, { confirmName: `John Renamed ${stamp}` });
check('owner delete with the exact name → 200', del.status === 200 && del.body?.success === true, del);
check('soft delete: the row still exists with deleted_at set', (await count('SELECT count(*)::int n FROM organizations WHERE id = $1 AND deleted_at IS NOT NULL', [orgA.body.id])) === 1);
check('memberships kept (history)', (await count('SELECT count(*)::int n FROM memberships WHERE organization_id = $1', [orgA.body.id])) >= 2);
check('gone from the owner\'s /auth/me', !(await call('GET', '/auth/me', tJohnA)).body?.organizations?.some((o: Body) => o.slug === slugA));
check('gone from a member\'s /auth/me', !(await call('GET', '/auth/me', tTeammate)).body?.organizations?.some((o: Body) => o.slug === slugA));
check('gone from GET /orgs', !(await call('GET', '/orgs', tJohnA)).body?.some?.((o: Body) => o.slug === slugA));
const reselect = await call('POST', '/auth/select-org', tJohnA, { slug: slugA });
check('select-org refuses it (404)', reselect.status === 404, reselect);
const oldToken = await call('GET', '/brands/me', tA);
check('a token minted for it before deletion → 403 on the next request', oldToken.status === 403, oldToken);
check('pending invitation link is dead (preview 404)', (await call('GET', `/orgs/invitations/preview?token=${pending.token}`, null)).status === 404);
check(
  'organization.deleted audited with the org id',
  (await count(`SELECT count(*)::int n FROM audit_events WHERE action = 'organization.deleted' AND entity_id = $1 AND result = 'success'`, [orgA.body.id])) === 1,
);
check('the other john\'s org is untouched', (await call('GET', '/auth/me', tJohnB)).body?.organizations?.some((o: Body) => o.slug === slugB));

// ── Summary ──────────────────────────────────────────────────────────────
await admin.end();
await db.$disconnect();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAILED: ${f.label}`);
  process.exit(1);
}
