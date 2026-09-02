# @bebest/api

The BeBest platform API — a Hono app covering Epic 0's backend foundation:
structured logging, request IDs, magic-link + JWT (RS256) auth, sessions,
organizations/memberships/invitations, RBAC matching
`docs/08-security/SECURITY.md`, tenant-context resolution, audit logging,
and durable (Postgres-backed) rate limiting.

All database access goes through `@bebest/database` — this app never
imports `@prisma/client` directly (see that package's `src/client.ts`).

## Running it

```bash
# from the platform/ root
pnpm install
pnpm --filter @bebest/database generate   # generates the Prisma client (schema-only, no DB needed)
pnpm --filter @bebest/api dev              # tsx watch src/server.ts
```

There is no database to point at yet in this repo state — Epic 0 never
connects to one (see `platform/packages/database/DECISIONS.md`). To
actually run the server end-to-end you need:

1. A real Postgres instance (local Docker/Postgres 16, or Supabase per
   ADR-011).
2. `DATABASE_URL` pointing at it.
3. Prisma migrations applied (`prisma migrate dev` from
   `packages/database`, or `migrate deploy` in a real environment), THEN
   `packages/database/prisma/migrations/0000_init/rls.sql`, `checks.sql`,
   and `indexes.sql` applied as raw SQL (Prisma does not run these — they
   are not part of a generated migration, see that package's DECISIONS.md).
4. Two Postgres roles: `bebest_app` (non-owner, no BYPASSRLS — what this
   API actually connects as) and `bebest_admin` (for migrations/seeding/
   background workers that need cross-tenant access). See
   `packages/database/src/client.ts`'s top comment for why both are
   required once RLS is `FORCE`d.
5. An RS256 keypair for `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (see below).

None of that is done in this repo yet — it's the user's own infrastructure
step, not something this codebase can do for itself.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes (to actually run) | Postgres connection string. Used by `@bebest/database`. |
| `JWT_PRIVATE_KEY` | Yes (to sign tokens) | PEM-encoded RSA private key (PKCS8), RS256. See below to generate one. |
| `JWT_PUBLIC_KEY` | Yes (to verify tokens) | PEM-encoded RSA public key (SPKI), matching the private key. |
| `PORT` | No | Defaults to `3001`. |
| `NODE_ENV` | No | `production` disables the dev auth bypass unconditionally. |
| `ALLOW_DEV_AUTH_BYPASS` | No | Must be `true` (in addition to `NODE_ENV !== 'production'`) to enable the `X-User-Id` header bypass for local dev/tests. Two separate opt-ins by design — see `src/middleware/auth.ts`. |
| `APP_URL` | No | Used to build the magic-link URL sent to `EmailSender`. Defaults to `http://localhost:3000`. |
| `RESEND_API_KEY` | Not used yet | Reserved for ADR-010 — no `ResendEmailSender` exists yet, see "Not done" below. |
| `CRM_INTERNAL_ORG_ID` | Yes (to use `/api/leads`, `/api/deals`, `/api/activities`, `/api/accounts`) | UUID of the `organizations` row that is BeBest's own internal operations tenant — every CRM row is RLS-scoped to it (see `src/lib/internal-org.ts` and `@bebest/database` DECISIONS.md §14). Nothing seeds this row automatically; create one org (e.g. via `POST /api/orgs`) and put its id here. |

Generate a dev RSA keypair:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
# Paste the contents of private.pem into JWT_PRIVATE_KEY and public.pem into JWT_PUBLIC_KEY.
# Both accept either real newlines or literal "\n" (the loader normalizes either form).
```

## What's implemented

- **Structured logging** (`src/middleware/logger.ts`) — one JSON line per
  request to stdout. Never logs request/response bodies (may contain
  tokens/PII).
- **Request IDs** (`src/middleware/request-id.ts`) — generated or
  echoed from `X-Request-Id`, included in every log line and error response.
- **Security headers + CORS** (`src/app.ts`) — CSP, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  HSTS — matching `docs/08-security/SECURITY.md`'s required header list.
- **Auth** (`src/routes/auth.ts`, `src/lib/jwt.ts`) — magic-link request +
  verify, 15-minute RS256 access tokens, 7-day rotating refresh tokens
  backed by a `sessions` row (revocable), logout, and `/select-org` to move
  from "authenticated, no org chosen" to an org-scoped access token.
  Passwordless only — see "Not done" for why there's no password auth.
- **Orgs/memberships/invitations** (`src/routes/orgs.ts`) — create (with
  the creator auto-added as `owner`), get/update/soft-delete, list/change/
  remove members, send/accept invitations.
- **RBAC** (`src/lib/rbac.ts`, `src/middleware/rbac.ts`,
  `src/middleware/tenant-context.ts`) — the exact permission matrix from
  SECURITY.md as data, plus a role-hierarchy check for coarser
  "at least X" gates. Role is ALWAYS re-read from `memberships` on every
  request; never trusted from the JWT (the JWT's `org` claim is a hint for
  which org to resolve, not an authorization decision by itself).
- **Tenant context** (`src/middleware/tenant-context.ts`) — two variants:
  `requireOrgBySlug` (URL `:slug` param — used by the org-management
  routes) and `requireOrgFromToken` (the JWT `org` claim — for routes that
  don't carry a slug). Both re-verify membership against the database
  before setting context.
- **Audit logging** (`src/lib/audit.ts`, `src/middleware/audit-log.ts`) —
  attach `auditLog({ action, entityType })` to a route and it logs
  automatically after the handler runs, with `result: success|failure`
  based on the actual response status. Wired onto org deletion, role
  changes, and login/logout — the full "always audited" list from
  SECURITY.md is in `lib/audit.ts`'s `ALWAYS_AUDITED_ACTIONS` for reference
  as more routes get built in later epics.
- **Rate limiting** (`src/lib/rate-limiter.ts`, `src/middleware/rate-limit.ts`)
  — durable, Postgres-backed (via `organization_rate_limits`, NOT
  RLS-protected — see `@bebest/database`'s DECISIONS.md §7a for why),
  replacing the previous in-memory-`Map` implementation. Pre-built limiters
  matching SECURITY.md's table: `publicRateLimit` (30/min, applied
  globally in `app.ts`), `authRateLimit` (5/15min), `freeSnapshotRateLimit`
  (1/hour), `authenticatedRateLimit` (120/min), `aiQueryRateLimit`
  (10/min/org), `adminRateLimit` (30/min).
- **Epic 1 — CRM** (`src/routes/{leads,deals,activities,accounts}.ts`,
  `src/middleware/crm-access.ts`, `src/lib/internal-org.ts`,
  `src/lib/ssrf-guard.ts`) — leads inbox, deal pipeline (with a dedicated,
  always-audited stage-transition endpoint), lead→org conversion, and an
  activity timeline, gated by `requireCrmAccess` (caller must be a member of
  the fixed internal BeBest ops org, not any customer org) plus the
  `manage_leads`/`manage_deals`/`log_crm_activities`/`view_crm` entries in
  `lib/rbac.ts`'s permission matrix. `accounts` is a read view assembled
  over `organizations` + a converted `leads` row + its `deals`/`activities`,
  not a table of its own. Full writeup:
  `platform/docs/epics/01-crm-backend.md`.
- **Email abstraction** (`src/lib/email.ts`) — `EmailSender` interface,
  `ConsoleEmailSender` (logs instead of sending) is the only implementation
  right now. `createAuthRoutes(emailSender)` takes the sender as a
  parameter specifically so swapping in Resend later (ADR-010) touches one
  line in `app.ts`, not any route logic.

## Tests

`pnpm test` (vitest). Every test mocks `@bebest/database` — none of them
connect to Postgres. Pure-logic areas (`lib/rbac.ts`, `lib/jwt.ts`,
`lib/rate-limiter.ts`'s bucketing math) have direct unit tests; middleware
and routes are tested through Hono's `app.request()` with a hand-rolled
mock Prisma client per test file.

`src/routes/tenant-isolation.integration.test.ts` is the one exception:
every test in it is `.skip`/`.todo` and explicitly marked **NEEDS LIVE DB**
— tenant isolation (docs/19-testing/TESTING_STRATEGY.md's hard quality
gate) can only be proven against a real Postgres instance with
`rls.sql`'s policies actually applied. The file documents exactly which
scenarios must pass before this gate can be called satisfied; it is not
skipped silently.

## What's NOT done (honest gaps, not oversights)

- **OAuth (Google/GitHub)** — SECURITY.md lists this as a secondary auth
  method. Not implemented; magic link is the only auth method right now.
- **Password auth** — deliberately not implemented. SECURITY.md's primary
  method is magic link; `users.password_hash` is nullable in the schema
  for exactly this reason. If a future epic needs it, it's additive.
- **Resend wiring** — `ConsoleEmailSender` is the only `EmailSender`. No
  `RESEND_API_KEY` is read anywhere. Swapping this in is a single new
  class + one line in `app.ts`.
- **Invitation emails go through `console.log`, not `EmailSender`** —
  `routes/orgs.ts`'s invitation endpoint predates the `EmailSender`
  refactor done for magic links; it should be converted to the same
  factory pattern (`createOrgRoutes(emailSender)`) as a quick follow-up.
- **CSRF protection** — SECURITY.md calls for double-submit-cookie CSRF
  protection for browser/cookie-based sessions. This API is
  bearer-token-only (no cookies are set), which is its own mitigation for
  classic CSRF, but if a future epic adds cookie-based session auth,
  explicit CSRF tokens need to be added then.
- **Autonomy-level entitlement flag** — `hasPermission(..., 'autonomous_actions')`
  only encodes the role half of "owner/admin (if enabled)" from
  SECURITY.md's matrix. The org-level "is autonomy enabled" entitlement
  flag itself doesn't exist yet (no `organizations.settings.autonomyEnabled`
  reader) — that's an Epic 12 (agents) concern.
- **`no-restricted-imports` for `@prisma/client`** — the "apps/api never
  imports `@prisma/client` directly" rule is enforced by convention/code
  review right now, not by an ESLint rule. Adding one to this app's
  `eslint.config.mjs` is a cheap follow-up.
- **Refresh-after-select-org rough edge** — `POST /auth/refresh` issues a
  new access token WITHOUT re-attaching whichever org was active on the
  token being refreshed (it doesn't have access to the old access token,
  only the refresh token). Clients need to call `/select-org` again after
  a refresh if they need continued org context. Fixing this properly means
  either storing the last-selected org on the session row, or having the
  client resubmit it — deferred rather than guessed at for Epic 0.
- **`writeAuditEvent` and the tenant-context membership lookups run outside
  `withOrgContext`** in a couple of spots (see `lib/audit.ts`'s top
  comment) — correct today because `audit_events` accepts nullable org and
  `memberships` is scoped by `app.current_user`, not `app.current_org`, but
  worth re-reading against `@bebest/database`'s DECISIONS.md if new tables
  are added to either code path later.
- **Integration tests against a live database** — see
  `tenant-isolation.integration.test.ts` above; also true for anything
  exercising real RLS/CHECK-constraint enforcement, not just tenant
  isolation specifically.
- **No OpenAPI/route documentation** — routes are documented here in prose
  only. A generated spec (e.g. `@hono/zod-openapi`) is a reasonable addition
  once there are enough routes to justify it.
- **CRM (`leads`/`deals`/`activities`) full SSRF protection** — `lib/ssrf-guard.ts`
  rejects non-http(s) schemes and literal-IP private/loopback ranges at the
  point a URL is stored, but nothing in this epic fetches a stored URL, so
  it does not (and cannot) close the DNS-rebinding gap a real fetch-time
  check needs. Whichever future epic actually crawls/fetches one of these
  URLs must add its own request-time SSRF guard — see `ssrf-guard.ts`'s
  top comment.
- **CRM has no seed/bootstrap step for the internal org** — `CRM_INTERNAL_ORG_ID`
  above must point at a real, already-created `organizations` row; nothing
  in this codebase creates that row automatically.

## Commands the user will need to run themselves later

```bash
pnpm install                                    # once, from platform/
pnpm --filter @bebest/database generate         # regenerate Prisma client after any schema change

# Once a real database exists:
pnpm --filter @bebest/database exec prisma migrate dev   # or `migrate deploy` in CI/prod
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/rls.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/checks.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0000_init/indexes.sql
# Epic 1 (CRM) — leads/deals/activities RLS + CHECK + partial indexes:
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/rls.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/checks.sql
psql "$DATABASE_URL" -f packages/database/prisma/migrations/0002_crm/indexes.sql
# Create the bebest_app / bebest_admin roles per packages/database/src/client.ts's
# top comment, and point DATABASE_URL at bebest_app for the running API.
# Then create one organizations row for BeBest's own internal CRM use (e.g.
# via POST /api/orgs) and set CRM_INTERNAL_ORG_ID to its id.

pnpm --filter @bebest/api dev                   # run the API
pnpm --filter @bebest/api test                  # run this app's test suite
```
