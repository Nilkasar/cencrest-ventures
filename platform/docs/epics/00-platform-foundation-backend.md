# Epic 0 — Platform Foundation (backend half): completion summary

Scope: `platform/packages/database` (`@bebest/database`) and
`platform/apps/api` (`@bebest/api`). Branch `rebuild/platform`, no other
branch touched, nothing under `api/`, `web-app/`, or the repo-root
marketing site was modified.

**No database was connected to at any point.** `prisma generate` and
`prisma validate` were run (schema-only). No `migrate`, `db push`, or
`db pull` was run, per the hard constraint. `pnpm install` was run to
fetch dependencies for typechecking/testing.

---

## What was built

### `platform/packages/database` (`@bebest/database`)

- `prisma/schema.prisma` — a hardened port of `api/prisma/schema.prisma`'s
  96 models. Every change is catalogued in `packages/database/DECISIONS.md`;
  the headline items:
  - `organization_id` denormalized onto every table reachable from a brand
    (58 tables gained it; 24 already had it under an inconsistent
    `org_id`/`organization_id`/`agency_org_id` naming, now unified).
  - Row-Level Security enabled + `FORCE`d on 80 tenant tables
    (`prisma/migrations/0000_init/rls.sql`), with a documented,
    deliberate list of what's excluded and why (identity/lookup tables
    queried before tenant context exists, user-scoped security artifacts,
    platform reference data, and — found during review, not assumed away —
    `memberships` needing a non-standard OR-based policy and
    `invitations`/`organization_rate_limits` needing NO RLS at all; see
    "Bugs found and fixed" below).
  - CHECK constraints on ~25 genuinely closed-value VARCHAR columns
    (`prisma/migrations/0000_init/checks.sql`).
  - Supplemental partial indexes for hot query paths Prisma's schema DSL
    can't express (`prisma/migrations/0000_init/indexes.sql`).
  - `created_by`/`updated_by` added wherever a human action was
    untracked; `deleted_at` added to customer-editable tables that lacked
    it; every `DateTime` column converted to `TIMESTAMPTZ`; `ip_address`
    columns converted to native `INET`; FK `ON DELETE` reviewed table by
    table (`RESTRICT` on every `organization_id`/`brand_id` reference,
    `CASCADE` only for true composition children, `SetNull` for optional
    user references).
  - `audit_events` hardened to match SECURITY.md's exact shape
    (`result`, `actor_type`, `actor_role` added).
  - `role` enum widened from `{owner, admin, member, viewer}` to
    `{owner, admin, analyst, editor, viewer, member}` (member kept as a
    deprecated alias) to match SECURITY.md's role matrix.
- `src/client.ts` — the typed Prisma client wrapper. `apps/api` never
  imports `@prisma/client` directly. Exports `db` (unscoped — for tables
  without RLS or admin/system code), `withOrgContext`, `withUserContext`,
  `withUserAndOrgContext` (each opens a transaction, sets the relevant
  Postgres session variable via `set_config(..., true)`, and runs the
  callback — the one sanctioned way to touch a tenant table).
- `src/client.test.ts` — 7 unit tests on `withOrgContext`'s UUID validation
  and `set_config` call, with a mocked `@prisma/client`.
- `DECISIONS.md` — every schema change, with reasoning, organized by
  category (multi-tenancy, RLS, soft-delete/timestamps, created_by/
  updated_by, FK policy, CHECK constraints, the two-role deployment
  requirement, the client wrapper, the role enum, audit_events, indexing,
  and what was deliberately left alone).

### `platform/apps/api` (`@bebest/api`)

- `src/app.ts` / `src/server.ts` — Hono app: security headers (CSP,
  X-Frame-Options, HSTS, etc. matching SECURITY.md), CORS, request-id
  middleware, structured JSON request logging, a baseline public rate
  limit, and route mounting.
- `src/lib/jwt.ts` — RS256 access tokens (15 min), rotating refresh tokens
  (7 days, DB-backed via `refresh_tokens` + `sessions`). Deliberately omits
  a `role` claim (see DECISIONS.md) even though SECURITY.md's literal claim
  list includes one.
- `src/lib/rbac.ts` — the SECURITY.md permission matrix as data
  (`hasPermission`) plus a role-hierarchy check (`isAtLeast`) for coarser
  gates.
- `src/lib/email.ts` — `EmailSender` interface + `ConsoleEmailSender` (dev
  stub). `createAuthRoutes(emailSender)` takes it as a parameter so Resend
  (ADR-010) can be wired in later without touching route logic.
- `src/lib/rate-limiter.ts` + `src/middleware/rate-limit.ts` — durable,
  Postgres-backed rate limiting (fixed-window counters in
  `organization_rate_limits`), replacing the old in-memory `Map`
  implementation. Pre-built limiters match SECURITY.md's table exactly.
- `src/lib/audit.ts` + `src/middleware/audit-log.ts` — automatic audit
  logging attachable to any route; wired onto org deletion and role
  changes (both on SECURITY.md's "always audited" list) plus login/logout.
- `src/middleware/auth.ts` — JWT verification + user load, with a
  double-opt-in dev bypass (`NODE_ENV !== 'production'` AND
  `ALLOW_DEV_AUTH_BYPASS=true`).
- `src/middleware/tenant-context.ts` — `requireOrgBySlug` (URL param) and
  `requireOrgFromToken` (JWT `org` claim — the literal deliverable the
  task brief named). Both re-verify membership fresh from the database
  before setting context; role is never trusted from the token.
- `src/middleware/rbac.ts` — `requirePermission(action)`, the route-level
  enforcement of `lib/rbac.ts`'s matrix.
- `src/routes/auth.ts` — magic-link request/verify, refresh (rotating),
  logout, `/select-org`, `/me`.
- `src/routes/orgs.ts` — create/get/update/soft-delete org, list/change-role/
  remove members, send/accept invitations.
- 83 passing vitest tests across 10 files, all against a mocked
  `@bebest/database` (no live database anywhere in the suite) — pure-logic
  tests for RBAC/JWT/rate-limit math, middleware tests via Hono's
  `app.request()`, and route-level tests exercising the full auth/org
  flows.
- `src/routes/tenant-isolation.integration.test.ts` — every test
  `.skip`/`.todo` and marked **NEEDS LIVE DB**, documenting exactly which
  tenant-isolation scenarios (the TESTING_STRATEGY.md hard quality gate)
  must be proven against a real Postgres instance before this gate can be
  called satisfied.
- `README.md` — how to run it, every environment variable, what's
  implemented, and an honest "what's NOT done" list.
- `DECISIONS.md` — every deviation from the old `api/` implementation,
  with reasoning.

---

## Bugs found and fixed during the build (worth flagging explicitly)

Three real RLS design mistakes were made and then caught by re-reading the
resulting SQL against how the API would actually need to query each table
— none of these would have been caught by `prisma validate` or a type
checker, only by reasoning through the access patterns:

1. **`memberships`** scoped by `organization_id` would break "which orgs
   am I in" (no org selected yet at login). First fix (scope by `user_id`
   instead) broke the OTHER direction — "list every member of my org"
   needs to see other users' rows. Final fix: an OR of both clauses. See
   `@bebest/database/DECISIONS.md` §7a for the full reasoning and why the
   OR is safe.
2. **`organization_rate_limits`** scoped by `organization_id` would make
   anonymous, pre-auth rate limiting (brute-force protection on the auth
   endpoints themselves, the free-snapshot-per-IP limit) permanently
   non-functional, because those buckets have no org yet. Fixed: no RLS on
   this table; safety comes from the bucket-key design instead. §7a.
3. **`invitations`** scoped by `organization_id` would make invitation
   acceptance impossible — the whole point of an invitation is that the
   redeemer isn't a member yet, so they have no org context to satisfy the
   policy. Fixed: no RLS on this table, same reasoning already applied to
   `magic_link_tokens`/`password_reset_tokens`/`refresh_tokens`. §7b.

`apps/api`'s `routes/orgs.ts` was written, then corrected to match each of
these: `withUserContext` vs. `withOrgContext` chosen per query based on
which access pattern it actually is, and invitation writes left on the
plain (unscoped) `db` client to match table 3's design.

This is exactly the kind of thing `tenant-isolation.integration.test.ts`
exists to catch mechanically once a real database is available — these
three were caught by manual review instead, which is a weaker guarantee.

---

## Deviations from the original schema/logic (cross-reference)

Every deviation is documented in full, with reasoning, in:
- `platform/packages/database/DECISIONS.md` (schema/RLS/indexing/FK policy)
- `platform/apps/api/DECISIONS.md` (auth/RBAC/rate-limiting/audit logic)

The short version: RS256 instead of HS256, no password auth (magic-link
only, matching SECURITY.md's stated primary method), 7-day rotating
refresh tokens with real session revocation instead of 30-day tokens with
no revocation path, no `role` JWT claim (role is always re-read from the
database), the permission matrix encoded as data instead of ad hoc role
checks, Postgres-backed durable rate limiting instead of in-memory,
`audit_events` writes that didn't exist before, and an `EmailSender`
abstraction where the old code called `console.log` inline.

---

## What's genuinely NOT done (not oversights — see the two DECISIONS.md files and apps/api/README.md for the full lists)

- **No domain routes.** Brands, crawler, keywords, SEO, AI runs,
  opportunities, content, agents, publishing, billing, CRM, experiments,
  reports, white-label, etc. — none of the ~35 route files in the old
  `api/src/routes/` beyond auth and orgs were ported. That's Epics 1–19
  per `platform/EPICS.md`, not Epic 0. Those epics inherit an
  already-hardened schema and don't need to redo the RLS/CHECK/FK audit.
- **No OAuth, no password auth.** Magic link only, by design (see
  DECISIONS.md).
- **No Resend integration.** `ConsoleEmailSender` only; the seam
  (`EmailSender`) is in place. `routes/orgs.ts`'s invitation email also
  hasn't been converted to go through that seam yet (still `console.log`
  directly) — a quick, explicitly tracked follow-up.
- **No integration tests against a live database.** Everything is unit/
  mock-tested. Tenant isolation specifically (`tenant-isolation.
  integration.test.ts`) and general RLS/CHECK-constraint enforcement are
  the two things that genuinely cannot be verified without Postgres.
- **`no-restricted-imports` for `@prisma/client`** in `apps/api`'s own
  ESLint config isn't wired up — the "never import `@prisma/client`
  directly" rule is enforced by convention/review right now, not tooling.
- **The two-Postgres-role deployment requirement (`bebest_app` /
  `bebest_admin`) is documented but not provisioned** — cannot be done
  without a database connection. See `@bebest/database/src/client.ts`'s
  top comment and `packages/database/DECISIONS.md` §7.
- **Autonomy-level entitlement flag** (the "(if enabled)" half of
  SECURITY.md's autonomous-actions permission) isn't backed by a real
  `organizations.settings` reader yet — Epic 12's concern.
- **CSRF tokens** aren't implemented — not needed yet because this API is
  bearer-token-only (no cookies set), but flagged for whenever a future
  epic adds cookie-based session auth.

---

## Commands the user will need to run themselves later

```bash
# One-time, from platform/
pnpm install
pnpm --filter @bebest/database generate

# Once a real Postgres database exists (this repo build never connects to one):
pnpm --filter @bebest/database exec prisma migrate dev      # or `migrate deploy`
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/rls.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/checks.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/indexes.sql
# Create bebest_app (non-owner, no BYPASSRLS) and bebest_admin (migrations/
# seeding/background workers) roles — see packages/database/src/client.ts.
# Point the running API's DATABASE_URL at bebest_app.

# Generate a dev RS256 keypair (see apps/api/README.md) and set
# JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.

pnpm --filter @bebest/api dev     # run the API
pnpm --filter @bebest/api test    # 83 tests, no DB required
pnpm --filter @bebest/database test
```

## Verification performed in this build (all schema-only / mocked)

- `prisma validate` — schema is syntactically valid.
- `prisma generate` — client generates cleanly.
- `tsc --noEmit` — clean on both packages.
- `eslint` — clean on both packages.
- `vitest run` — 90 tests total (7 in `@bebest/database`, 83 in
  `@bebest/api`), all passing, zero live-database dependencies.
