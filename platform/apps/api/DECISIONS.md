# @bebest/api — decisions vs. the original implementation

Port source: `api/src/{lib,middleware,routes}/*` (specifically `jwt.ts`,
`rbac.ts`, `db.ts`, `plans.ts`, `middleware/*`, `routes/auth.ts`,
`routes/orgs.ts`). This lists every deliberate deviation and why.

## Auth

- **HS256 → RS256.** The old `jwt.ts` used HMAC (`HS256`) with a single
  shared secret for both signing and verifying. `docs/08-security/
  SECURITY.md` requires RS256. Beyond just "the doc says so": RS256 means
  only this process needs the private key; anything that only needs to
  verify tokens (a future separate service, a CDN edge check, etc.) can
  hold just the public key. Implemented in `src/lib/jwt.ts` via `jose`'s
  `importPKCS8`/`importSPKI`.
- **Password auth removed.** The old `routes/auth.ts` had `/register`,
  `/login` (argon2), and password-reset endpoints alongside magic link.
  SECURITY.md's primary method is magic link; password auth is not
  mentioned at all. Rather than port dead-weight password flows (and their
  argon2 dependency), Epic 0 implements magic-link-only, and
  `users.password_hash` is nullable in the new schema specifically to
  support accounts that never set one. If a later epic decides password
  auth is needed, it's additive, not a rework.
- **Refresh tokens: 30 days → 7 days, and DB-backed session revocation
  added.** SECURITY.md specifies 7 days with rotation on use. The old code
  used 30 days and had a `refresh_tokens` table but no `sessions` table
  wired into the rotation flow, so there was no way to revoke "this
  device" without deleting/rotating every refresh token for a user. The
  new `routes/auth.ts` creates a `sessions` row at login, threads
  `session_id` through every rotation, and checks `session.revoked_at` on
  refresh — so logout can (and a future "sign out this device" feature
  could) revoke one session's lineage without touching others.
- **No `role` claim in the access token.** SECURITY.md's literal claim
  list is `sub, org, role, iat, exp`. This implementation omits `role`
  deliberately — see `src/lib/jwt.ts`'s top comment. Putting role in the
  token creates a standing temptation to read `payload.role` somewhere and
  skip the DB check, which is exactly the mistake SECURITY.md's own RBAC
  section forbids ("Never rely on client-sent role — always read from
  database"). `tenant-context` middleware re-reads role from `memberships`
  on every single request; there was never a version of this codebase
  where a stale/forged role claim could do anything.
- **`org` claim is a two-step "select an organization" flow, not present
  at login.** A user can belong to several orgs; there is no correct
  "the" org to embed in the very first token issued at login. `POST
  /auth/select-org` verifies membership and mints a new, org-scoped access
  token. `tenant-context`'s `requireOrgFromToken` reads that claim as a
  hint and still re-verifies membership before trusting it.
- **Dev auth bypass hardened, not removed.** The old `middleware/auth.ts`
  had an `X-User-Id` bypass gated only on `NODE_ENV !== 'production'`.
  Kept (it's genuinely useful for local dev and tests), but now requires a
  SECOND explicit opt-in, `ALLOW_DEV_AUTH_BYPASS=true`, specifically so a
  deployment can't end up with it active just because someone forgot to
  set `NODE_ENV=production` — two independent mistakes are required now,
  not one.

## RBAC

- **Permission matrix encoded as data**, not scattered `if (role === ...)`
  checks. The old `rbac.ts` had only a numeric role-rank hierarchy
  (`owner > admin > member > viewer`), which cannot express SECURITY.md's
  actual matrix — e.g. "editor can approve only their own drafts" or
  "owner-only billing" aren't hierarchy facts, they're per-action facts.
  `src/lib/rbac.ts`'s `PERMISSION_MATRIX` transcribes the SECURITY.md table
  verbatim; `hasPermission(role, action, opts)` is the single place that
  answers "can this role do this."
- **Role enum widened** (see `@bebest/database` DECISIONS.md §9) from
  `{owner, admin, member, viewer}` to
  `{owner, admin, analyst, editor, viewer, member}`. `analyst` and `editor`
  are the same hierarchy RANK in `isAtLeast` (neither is senior to the
  other — they have different, non-overlapping permissions), which is a
  genuine (and correct) departure from a strictly-linear hierarchy.

## Tenant context

- **New middleware, doesn't exist in the old code as a separate concept.**
  The old `requireOrgRole` (in `middleware/auth.ts`) conflated
  "authenticate" and "resolve+authorize org" into one function keyed only
  off a `:slug` route param. This implementation splits it:
  `middleware/auth.ts`'s `requireAuth` only authenticates;
  `middleware/tenant-context.ts` resolves org context, with two entry
  points (`requireOrgBySlug` for URL-addressed org resources,
  `requireOrgFromToken` for the JWT-`org`-claim case the task brief asked
  for explicitly). Both share one `resolveOrgContext` function so there is
  exactly one place that reads `memberships`.
- **`memberships` queries use `withUserContext` OR `withOrgContext`
  depending on the access pattern, never plain `db`.** This is a
  `@bebest/database` RLS design detail (see that package's DECISIONS.md
  §7a — the policy is an OR of a user-scoped and an org-scoped clause).
  `routes/auth.ts`'s `/me` and `/select-org`, and `routes/orgs.ts`'s
  "list my orgs" and invitation-accept, use `withUserContext` (reading the
  CALLER's own rows across orgs). `routes/orgs.ts`'s "list members",
  "change a member's role", and "remove a member" use `withOrgContext`
  (reading OTHER users' rows, all within one already-authorized org).
  Using the wrong one isn't a subtle performance issue — it's a hard
  failure: `withUserContext` for "list members" would return only the
  caller's own membership row, silently hiding every teammate.
- **`invitations` queries use plain `db`, not `withOrgContext`, on
  purpose.** This table has no RLS at all (see `@bebest/database`
  DECISIONS.md §7b) because accepting an invitation happens before the
  caller has any org to prove membership of. `routes/orgs.ts`'s
  invitation create/cancel calls still filter by `organization_id`
  explicitly in their `WHERE`/`data` clauses — there is just no second,
  database-enforced check backing that filter for this one table.

## Audit logging

- **New — the old code had no `audit_events` writes at all** despite
  SECURITY.md requiring them for a specific list of actions. `lib/audit.ts`
  + `middleware/audit-log.ts` are new. Wired onto organization deletion and
  role changes (both explicitly on SECURITY.md's "always audited" list) and
  auth login/logout as a demonstration of the pattern; the remaining items
  on that list (billing changes, content publishing, agent actions, API
  key lifecycle, data export) don't have routes yet (later epics) but
  `ALWAYS_AUDITED_ACTIONS` in `lib/audit.ts` exists precisely so whoever
  builds those routes has the vocabulary already defined instead of
  inventing new action-name strings ad hoc.

## Rate limiting

- **In-memory `Map` → Postgres-backed (`organization_rate_limits`).** The
  old `middleware/{ratelimit,rate-limit}.ts` (note: there were TWO
  near-duplicate files in the old codebase, both in-memory, one clearly
  dead code — this implementation has exactly one) explicitly commented
  "Replace with Redis/pg-based in production." This is that replacement:
  `lib/rate-limiter.ts` does a single atomic upsert per fixed window
  against a durable table, so limits survive a process restart and are
  shared correctly across multiple API instances (an in-memory `Map`
  is per-process — under 2+ instances behind a load balancer, the old
  approach effectively multiplied every limit by the instance count).
- Limits match SECURITY.md's table exactly (30/min public, 5/15min auth,
  1/hour free-snapshot, 120/min authenticated, 10/min/org AI queries,
  30/min admin) — the old code's hardcoded limiters (`apiRateLimit: 100/min`,
  `authRateLimit: 10/min`, `crawlRateLimit: 5/min`) didn't match the
  documented table at all.

## Email

- **New abstraction — the old code called `console.log` directly** inline
  in `routes/auth.ts` and `routes/orgs.ts` with a `// TODO Epic 3+: send via
  Resend` comment. `lib/email.ts`'s `EmailSender` interface +
  `ConsoleEmailSender` turns that TODO into an actual seam: `routes/auth.ts`
  takes an `EmailSender` via `createAuthRoutes(emailSender)` specifically so
  the eventual `ResendEmailSender` is a single new class plus one changed
  line in `app.ts`. (`routes/orgs.ts`'s invitation email was NOT converted
  to this pattern yet — see README.md's "not done" list.)

## Scope cuts vs. the old `api/` app (by design, not oversight)

The old `api/src/routes/` directory has ~35 route files (brands, crawl,
keywords, billing, CRM, AI runs, opportunities, content, agents, publishing,
experiments, learning, reports, white-label, etc.). Epic 0's brief is
platform foundation only: auth, orgs, RBAC, tenant isolation, audit,
rate limiting. None of the domain routes were ported — they belong to
Epics 1–19 per `platform/EPICS.md`, each of which owns its own schema
hardening review (already done for the whole schema at once in
`@bebest/database`, so those epics inherit hardened tables) and route
implementation.
