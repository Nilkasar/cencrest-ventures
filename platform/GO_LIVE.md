# BeBest Platform — Go-Live Checklist

Everything left between "code is merged to `main`" and "this is a real, running production system." Nothing in `platform/` has ever been run against a live database or a real external provider during the rebuild (`rebuild/platform` → `main`, 21/21 epics VERIFIED, see `platform/EPICS.md` and `platform/docs/epics/21-final-audit.html`) — that was deliberate the entire way through. This document is the list of what a human now has to actually do.

Nothing here is a code change. Everything below is configuration, infrastructure, or a decision.

---

## 1. Database

### 1.1 Provision Postgres and apply the schema

1. Stand up a real Postgres 16 instance and set `DATABASE_URL`.
2. Apply the Prisma-tracked schema:
   ```
   pnpm --filter @bebest/database exec prisma migrate deploy
   ```
3. **Separately**, apply every migration folder's raw SQL by hand — Prisma never runs these files (they're RLS/CHECK-constraint/index definitions, not Prisma migrations):
   ```
   for d in packages/database/prisma/migrations/*/; do
     for f in "$d"*.sql; do
       [ -f "$f" ] && psql "$DATABASE_URL" -f "$f"
     done
   done
   ```
   19 migration folders exist (`0000_init` through `0018_reporting_notifications`), each holding some subset of `checks.sql` / `rls.sql` / `indexes.sql`. All 19 need this, not just the first couple `apps/api/README.md`'s own example happens to show.

### 1.2 Create the two required Postgres roles

RLS is `FORCE`d on every tenant table — a role with `BYPASSRLS` or table ownership silently defeats it. Two roles are required (see `packages/database/src/client.ts`'s header comment):

- **`bebest_app`** — no `BYPASSRLS`, not the table owner. What the running API actually connects as.
- **`bebest_admin`** — migrations/seeding/admin tooling only. Never serves a real request.

### 1.3 Seed the billing plan catalog

Required — an empty `plans` table breaks every billing route (Epic 16):
```
pnpm --filter @bebest/api run seed:plans
```
Idempotent (upserts by slug), safe to re-run.

### 1.4 Bootstrap the CRM internal org

`CRM_INTERNAL_ORG_ID` (env var, §2) must point at a real, already-created `organizations` row. Nothing creates this automatically. One-time manual step:
1. Create an org the normal way: `POST /api/orgs` (as any authenticated user — this becomes BeBest's own internal ops workspace, not a customer org).
2. Put that org's real id into `CRM_INTERNAL_ORG_ID`.

Without this, every CRM route (`/api/leads`, `/api/deals`, `/api/activities`, `/api/accounts`) fails outright.

### 1.5 Run the integration test suite against this real database (recommended, not optional)

79 tenant-isolation tests are `.skip`/`.todo` across the whole build (`tenant-isolation.integration.test.ts`) — every one of them needs a live, RLS-applied Postgres connection to ever run, and none of them have. This is the single largest "not actually proven yet" claim in the entire rebuild. Un-skip and run them against the real database from 1.1–1.2 before trusting tenant isolation in production.

---

## 2. Environment variables

### Backend (`platform/apps/api`)

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | **Required** | Postgres connection string |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | **Required** | RS256 PEM keys for access/refresh tokens. `apps/api/README.md` has the exact `openssl genpkey`/`openssl pkey` commands. |
| `CRM_INTERNAL_ORG_ID` | **Required** (for CRM routes) | See §1.4 |
| `BILLING_WEBHOOK_SECRET` | **Required** (for billing) | Verifies Stripe-shaped webhook signatures |
| `APP_URL` | Recommended | Used to build magic-link/invite/snapshot-report URLs. Defaults to `http://localhost:3000` — **must** be set to the real domain in production or every email link is wrong. |
| `PORT` | Optional | Defaults to `3001` |
| `NODE_ENV=production` | **Required** | Unconditionally disables the dev auth bypass |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY`, `OLLAMA_BASE_URL` | At least one needed | Real AI provider keys — without any of these, AI Visibility/GEO features have nothing to call |
| `RESEND_API_KEY` | Not usable yet | Reserved, but no `ResendEmailSender` class exists — see §3 |
| `SENTRY_DSN` | Not usable yet | Reserved, but never `.init()`-ed — see §3 |
| `JOB_QUEUE_DATABASE_URL` | Not usable yet | Reserved, `PgBossJobQueue` is never started — see §3 |
| `ALLOW_DEV_AUTH_BYPASS` | Never in prod | Dev/test only; requires both this AND `NODE_ENV !== 'production'` |

### Frontend (`platform/apps/web`)

| Variable | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Required** | Defaults to `http://localhost:4000/api` — must point at the real deployed API |

---

## 3. Providers that need a real implementation swapped in

Every one of these follows the same pattern: a single factory/singleton constructs the default, and all route/business code only ever calls the factory — so each swap is a one-line change at one file, not a refactor.

| Capability | Default today | Real class exists? | Swap site | What's needed |
|---|---|---|---|---|
| **Email** | `ConsoleEmailSender` (logs, sends nothing) | No — needs writing | `apps/api/src/app.ts:64` | Write a `ResendEmailSender implements EmailSender`, set `RESEND_API_KEY` |
| **Error tracking** | `ConsoleErrorTracker` | **Yes** — `SentryErrorTracker` fully written, just never started | `lib/observability/default-error-tracker.ts` | Construct `new SentryErrorTracker(process.env.SENTRY_DSN!)`, call `.init()` once at boot |
| **Durable job queue** | `InMemoryJobQueue` (a process restart loses pending jobs) | **Yes** — `PgBossJobQueue` fully written, just never started | `lib/queue/default-job-queue.ts` | Construct `new PgBossJobQueue(connectionString)`, call `.start()` once at boot — **needs §5's deployment decision first** |
| **Billing** | `NullPaymentProvider` | No — needs writing | `lib/billing/payment-provider.ts:293` | Write a real Stripe-backed class, real Stripe keys |
| **SEO data** | `NullSEODataProvider` | No — needs writing | `lib/seo/seo-data-provider.ts:176` | Write a real class against Search Console / DataForSEO / Semrush / Ahrefs / Serper (the file's own comment names these as the original candidates) |
| **CMS publishing** | `NullPublishTarget` | Intentionally out of scope — no real external CMS integration was ever meant to exist in this build | — | Not a go-live blocker, a future epic |

---

## 4. Fake / demo data — what's already gone, what to double-check

- CRM's old `fixtures.ts` was deleted this session — the frontend is fully wired to the real API, nothing fake ships there.
- The Overview dashboard and Settings → Team tab (also wired this session) pull from real endpoints, no fixture fallback.
- `data/fixtures.ts` in `apps/web` still exists and is imported in **15 files** (`git grep -l 'from "@/data/fixtures"' src/` — onboarding, actions, competitors, CRM, SEO/website intelligence, every Settings panel, the org-switcher, and the user menu). Every occurrence checked is `currentUser`/`currentOrganization` only — never a source of fake leads, deals, scores, or any other business data; this is app-wide "who am I / what org am I acting as" identity plumbing, not a data leak. But it's broader than a couple of leftover spots, and it means there's no single real "current session" hook yet — each screen independently imports the same fixture constant. **Worth a real pre-launch decision**: either accept this (it works today because these fixture values happen to resolve correctly for the common single-org case, same interim pattern the Team panel wiring used deliberately this session for `GET /auth/me`), or build one real `useCurrentUser()`/`useCurrentOrg()` hook backed by the real session and replace all 15 call sites before launch, especially for any user who belongs to more than one organization.
- No seed script exists for anything except billing plans (§1.3) — there is no "demo org" or "demo brand" seeded anywhere; a fresh production database starts genuinely empty.

---

## 5. Deployment target — an undecided infrastructure question

Root `CLAUDE.md` documents Vercel for the **marketing site only** (static HTML, project `cencrest`). Nothing in `platform/` targets Vercel — no `vercel.json` exists anywhere under it, and `apps/api` is a standard long-running Node/Hono server (`pnpm build` → `tsc`, `pnpm start` → `node dist/server.js`), not a serverless function shape.

**This matters concretely**: `PgBossJobQueue` (§3) needs a persistent process to poll for jobs. A serverless platform (including Vercel functions) does not provide that. Before wiring the durable queue in, decide:
- A persistent-process host for `apps/api` (Railway, Render, Fly.io, a plain VM/container — anything that stays running), **or**
- Accept the in-memory job queue's limitation (a restart loses pending jobs) if a serverless platform is chosen anyway.

`apps/web` (Next.js) deploys normally to Vercel or any Next.js host with no special constraint.

---

## 6. Known gaps to tell users/stakeholders about

Real, honestly-documented, not oversights — worth setting expectations before launch rather than someone discovering them live.

**Visible to end users:**
- Settings → Notifications preferences and Settings → Autonomy level selector are still placeholder screens — the underlying mechanisms exist (notifications fire, autonomy is hard-capped at Level 1 by default), but there's no UI yet to customize either.
- The Overview dashboard's SEO Health tile has no live score — the backend never persisted analysis results behind a `GET` route (only a mutating `POST /analyze` exists), so it links out to the SEO Intelligence screen instead of showing a number.
- Report PDF export is the browser's native print dialog, not a generated PDF file.
- An invited teammate can't yet redeem their invite link — `POST /invitations/accept` works and the email now sends for real (§ fixed this session), but no frontend page renders the accept flow yet.
- OAuth login (Google/GitHub) doesn't exist — magic link is the only sign-in method.

**Not visible to users, but real:**
- No single real "current session" hook exists yet — 15 files across the app independently read `currentUser`/`currentOrganization` from `data/fixtures.ts` rather than a shared session source. Works correctly for a single-org user today; a genuinely multi-org user could see the wrong org's identity in some corner of the UI. See §4.
- No CSRF tokens (mitigated today by bearer-token-only, no-cookie auth — only matters if cookie-based sessions are ever added later).
- `POST /auth/refresh` doesn't re-attach the previously-selected org; a client must call `/select-org` again after a token refresh.
- CRM's SSRF guard validates URLs at write time only — inert today since nothing fetches a stored CRM URL yet, but any future feature that does must add its own fetch-time guard.
- No OpenAPI/generated API docs — routes are documented in prose (`apps/api/README.md`) only.

---

## 7. Final pre-launch checklist

- [ ] Postgres provisioned, `DATABASE_URL` set
- [ ] `prisma migrate deploy` run
- [ ] All 19 migration folders' `checks.sql`/`rls.sql`/`indexes.sql` applied via `psql`
- [ ] `bebest_app` / `bebest_admin` Postgres roles created correctly (no `BYPASSRLS`, no ownership on `bebest_app`)
- [ ] `pnpm --filter @bebest/api run seed:plans` run
- [ ] Internal CRM org bootstrapped, `CRM_INTERNAL_ORG_ID` set
- [ ] 79 tenant-isolation integration tests run against the real database and passing
- [ ] `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` generated and set (real keys, not the dev pair)
- [ ] `APP_URL` set to the real production domain
- [ ] At least one real AI provider key set
- [ ] `NODE_ENV=production` set
- [ ] Deployment target for `apps/api` decided (§5) — persistent process, not serverless, if the durable queue matters at launch
- [ ] Email: `ResendEmailSender` written and wired, or accept console-only email until it is
- [ ] Error tracking: `SentryErrorTracker` wired and started, or accept console-only logging until it is
- [ ] Durable job queue: `PgBossJobQueue` wired and started, or accept the in-memory limitation until it is
- [ ] Billing: real Stripe provider written and wired, or accept billing as non-functional until it is
- [ ] `NEXT_PUBLIC_API_URL` (frontend) pointed at the real deployed API
- [ ] Decide on `data/fixtures.ts`'s 15 remaining `currentUser`/`currentOrganization` call sites (§4) — accept the single-org-user interim pattern, or replace with a real session-backed hook before launch (especially before onboarding any multi-org user)
