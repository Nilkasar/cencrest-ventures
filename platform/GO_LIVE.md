# BeBest Platform — Go-Live Checklist

Everything left between "code is merged to `main`" and "this is a real, running production system." Nothing in `platform/` has ever been run against a live database or a real external provider during the rebuild (`rebuild/platform` → `main`, 21/21 epics VERIFIED, see `platform/EPICS.md` and `platform/docs/epics/21-final-audit.html`) — that was deliberate the entire way through. This document is the list of what a human now has to actually do.

Nothing here is a code change. Everything below is configuration, infrastructure, or a decision.

---

## 0. The runbook — do these in this order

Sections 1–7 are reference, organised by topic. This section is the sequence, because
several steps produce a value a later step needs. Each one links to its detail below.

Set `DATABASE_URL` to the `bebest_admin` role for steps 2–5 (they create and seed
schema) and to `bebest_app` everywhere afterwards.

| # | Step | Produces / needs | Detail |
|---|---|---|---|
| 1 | Provision Postgres 16 (Neon, Supabase, RDS, anything) | the connection string | §1.1 |
| 2 | Create the `bebest_app` and `bebest_admin` roles | **`bebest_app` must not have `BYPASSRLS` and must not own the tables**, or tenant isolation is silently off | §1.2 |
| 3 | `pnpm --filter @bebest/database run db:apply` | 128 tables, constraints, indexes, RLS. Add `--dry-run` first. **`prisma migrate deploy` does nothing here** | §1.1 |
| 4 | `pnpm --filter @bebest/api run seed:plans` | the `plans` catalog. Every billing route 500s without it | §1.3 |
| 5 | `pnpm --filter @bebest/api run seed:dev` | prints `CRM_INTERNAL_ORG_ID=` — copy it, three later steps need it | §1.4 |
| 6 | Generate a production RSA keypair for `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | never ship the dev pair | §2 |
| 7 | Resend: add the sending domain, complete DNS verification, create an API key | `RESEND_API_KEY`, `EMAIL_FROM`. **Verify the domain first** — an unverified domain fails every send, and magic link is the only way to log in | §3 |
| 8 | Stripe: create one recurring Price per paid tier with `lookup_key` = the plan slug (`starter`, `growth`, `pro`, `agency`, `managed`, `enterprise`; `free` needs none) | lets a plan resolve to a Price | §3 |
| 9 | Stripe: add a webhook endpoint pointing at `POST /api/webhooks/billing`, copy its `whsec_…` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | §3 |
| 10 | Get at least one real AI provider key | the env var is `GOOGLE_API_KEY`, not `GOOGLE_AI_API_KEY` | §2 |
| 11 | Create the worker host (Railway / Render / Fly / a container). Build `pnpm --filter @bebest/api run build`, start `pnpm --filter @bebest/api run start:worker` | the process that actually runs jobs | §5 |
| 12 | Set the worker's env, including `JOB_QUEUE_DATABASE_URL` | **without it the worker exits 1.** It also needs the AI keys, `RESEND_API_KEY`, `APP_URL` and `CRM_INTERNAL_ORG_ID` — keys set only on Vercel buy you nothing, because the worker makes the AI calls | §2 |
| 13 | Set the Vercel `bebest-api` env (everything in §2 Backend, `NODE_ENV=production`) | | §2 |
| 14 | Point `NEXT_PUBLIC_API_URL` on `bebest-web` at the deployed API | | §2 |
| 15 | `pnpm --filter @bebest/api run smoke:crm` against the deployed API | first real end-to-end signal | §7 |
| 16 | Un-skip and run the 85 tenant-isolation integration tests against the real database | the largest unproven claim in the build. Do this before onboarding anyone | §1.5 |

### Verify the worker is actually consuming

The failure this split exists to fix is silent, so prove it rather than assuming:

1. Trigger an AI Visibility run.
2. The API should return `202` and the `ai_runs` row should go `queued` → `running`.
3. Watch the worker's logs — the work happens there, not on Vercel.
4. The row must reach `completed`. **If it sits at `running` forever, the worker is not
   consuming** — check `JOB_QUEUE_DATABASE_URL` is set on the worker and points at the
   same database, and that the worker process is alive.
5. Redeploy the worker mid-run on purpose once. The run should end `failed`, not stay
   `running` — that is the shutdown release working (§5). Use a *directly triggered*
   run for this check: `remeasurement` is the one job with no release path, so a
   kill during one strands the `ai_runs` row its inner run created and will fail
   this check legitimately (§6).

### Known gaps to expect on day one

None of these block launch, but you will hit them, so know them going in:

- **A customer cannot self-serve pay.** `StripeProvider` creates real subscriptions, but
  nothing in the product collects card details, so a new paid subscription is created
  `incomplete` until paid out of band. Invoicing works; checkout does not. See §3's Stripe
  caveat.
- **Dunning emails do not send.** A customer whose card fails hears nothing. §3.
- **The SEO half has no data source.** `NullSEODataProvider` returns word-count estimates.
  Anything sold as keyword or search-volume data cannot be delivered yet. §3.
- **AI cost figures are partly unverified.** Anthropic's rates were checked 2026-09-25;
  OpenAI, Google and Perplexity are still first-pass estimates (`PRICING_LAST_VERIFIED` is
  `null`). Fine for internal margin analysis, not for anything customer-facing. §6.
- **Spend ceilings are enforced at dispatch, not continuously.** A run that would breach
  a per-run or monthly ceiling is now refused before it starts, but concurrent requests
  price against the same month-to-date figure with no reservation, and spend is never
  re-checked mid-run. A query set enlarged after the estimate was taken runs at its new
  size against the old certificate. §6.
- **Ollama is mandatory.** Without it every run completes reporting a score of 0. See §2.

---

## 1. Database

### 1.1 Provision Postgres and apply the schema

1. Stand up a real Postgres 16 instance and set `DATABASE_URL` (export it, or put it in `packages/database/.env`).
2. Apply everything — tables, constraints, indexes and RLS policies — in one command:
   ```
   pnpm --filter @bebest/database run db:apply
   ```
   Add `--dry-run` first to see exactly what it will run.

> **Correction (2026-09-09).** This section previously said to run
> `prisma migrate deploy` and then apply each folder's SQL with `psql`.
> That does not work: the folders under `prisma/migrations/` contain
> hand-written `checks.sql` / `indexes.sql` / `rls.sql` / `ddl.sql` and no
> `migration.sql`, which is the only file Prisma's migrate command looks
> at — so `prisma migrate deploy` creates **nothing at all**, no tables and
> no policies. `packages/database/scripts/apply-sql.mjs` (the `db:apply`
> script) is what actually builds the schema: it renders the DDL from
> `schema.prisma` offline, applies it, then applies all 20 folders' SQL in
> order (`ddl` → `checks` → `indexes` → `rls` within each). It records what
> it applied in a `_bebest_applied_sql` ledger, so it is safe to re-run and
> a later migration folder applies on its own. It also needs no `psql`
> binary on the machine.
>
> For a database that was built before that ledger existed, run
> `pnpm --filter @bebest/database run db:apply -- --baseline` once to record
> the current files as applied without re-running them.
>
> This was verified end to end on 2026-09-09: all 20 folders applied
> cleanly to a fresh Postgres, 128 tables, zero failures.

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

`CRM_INTERNAL_ORG_ID` (env var, §2) must point at a real, already-created `organizations` row. Nothing creates this automatically.

```
pnpm --filter @bebest/api run seed:dev
```

creates the internal ops org plus its staff memberships and prints the
`CRM_INTERNAL_ORG_ID=` line to copy into the environment. It is idempotent.
Add `-- --samples` in a development environment to also seed example
leads/deals/accounts so the screens have something to render; leave it off
anywhere real.

(The manual route still works: `POST /api/orgs` as any authenticated user,
then copy that org's id.)

Without this, every CRM route (`/api/leads`, `/api/deals`, `/api/activities`, `/api/accounts`, `/api/crm/users`) fails outright.

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
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY` | At least one needed | The models a GEO query is actually asked. `geo.query` fans out across all four |
| `OLLAMA_BASE_URL` | **Required, not interchangeable** | `packages/ai-provider/src/registry.ts:34` routes `extraction: ['ollama']` with NO fallback. Without a reachable Ollama, extraction throws on every job, zero `brand_observations` are written, and the run still reaches `completed` — reporting an AI Visibility Score of **0**. A fabricated-looking headline number, silently. Either provide Ollama or give `extraction` a cloud fallback first |
| `RESEND_API_KEY` | **Required** (for email) | Switches `apps/api` from `ConsoleEmailSender` to the real `ResendEmailSender`. Without it NOBODY can log in to production — magic link is the only sign-in method. |
| `EMAIL_FROM` | Recommended | Envelope `From` for every transactional email. Defaults to `BeBest <hello@bebestwithai.com>`. Its domain must be verified in Resend or every send fails. |
| `STRIPE_SECRET_KEY` | **Required** (for billing) | Switches `apps/api` from `NullPaymentProvider` to the real `StripeProvider`. Unset = billing is non-functional but harmless. |
| `STRIPE_WEBHOOK_SECRET` | **Required** (for billing) | The endpoint signing secret (`whsec_…`) from Stripe → Developers → Webhooks. `BILLING_WEBHOOK_SECRET` is honoured as a fallback. |
| `SENTRY_DSN` | Not usable yet | Reserved, but never `.init()`-ed — see §3 |
| `JOB_QUEUE_DATABASE_URL` | **Required** (for any background job to complete) | Postgres connection string for the pg-boss job queue. **Set** → `apps/api` uses `PgBossJobQueue` and only ENQUEUES; the separate worker process consumes. **Unset** → `InMemoryJobQueue`, i.e. jobs run inside the HTTP process and on Vercel are killed the moment the response returns. Normally the same database as `DATABASE_URL` (pg-boss creates its own `pgboss` schema). See §5. |
| `ALLOW_DEV_AUTH_BYPASS` | Never in prod | Dev/test only; requires both this AND `NODE_ENV !== 'production'` |

### Worker (`platform/apps/api`, `pnpm start:worker`)

The worker is the same package deployed a second time as a persistent process
(§5). It needs, at minimum:

| Variable | Required? | Purpose |
|---|---|---|
| `JOB_QUEUE_DATABASE_URL` | **Required** | Without it the worker refuses to start (exit 1) — it would have nothing to consume |
| `DATABASE_URL` | **Required** | Same `bebest_app` role as the API. RLS is in force here too; every handler sets `app.current_org` via `withOrgContext` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `PERPLEXITY_API_KEY` | **Required** | This is the process that actually makes the AI calls. Keys set only on Vercel buy you nothing |
| `OLLAMA_BASE_URL` | **Required** | Not one of the interchangeable keys above — extraction routes to Ollama only. See the backend table for what a missing Ollama does to the score |
| `RESEND_API_KEY`, `EMAIL_FROM` | **Required** (for email) | The free-snapshot "your report is ready" email is sent from the worker, not the API |
| `APP_URL` | **Required** | The report link in that email is built from it |
| `CRM_INTERNAL_ORG_ID` | **Required** | Free-snapshot AI spend is attributed to this org |
| `NODE_ENV=production`, `SENTRY_DSN` | As per the API | Same meaning |
| `WORKER_SHUTDOWN_GRACE_MS` | Optional | Not read from the environment today — the grace period is `DEFAULT_SHUTDOWN_GRACE_MS` (20s) in `lib/queue/worker-runtime.ts`. Keep the host's SIGTERM→SIGKILL window above it |

It does **not** need `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`, `STRIPE_*`, or
`BILLING_WEBHOOK_SECRET` — it serves no requests and touches no billing.

### Frontend (`platform/apps/web`)

| Variable | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Required** | Defaults to `http://localhost:4000/api` — must point at the real deployed API |

---

## 3. Providers that need a real implementation swapped in

Every one of these follows the same pattern: a single factory/singleton constructs the default, and all route/business code only ever calls the factory — so each swap is a one-line change at one file, not a refactor.

| Capability | Default today | Real class exists? | Swap site | What's needed |
|---|---|---|---|---|
| **Email** | `ConsoleEmailSender` (logs, sends nothing) | **Yes** — `ResendEmailSender` written and wired | `apps/api/src/app.ts:64` | Set `RESEND_API_KEY` (and `EMAIL_FROM`), verify the sending domain in Resend. Nothing left to write. |
| **Error tracking** | `ConsoleErrorTracker` | **Yes** — `SentryErrorTracker` fully written, just never started | `lib/observability/default-error-tracker.ts` | Construct `new SentryErrorTracker(process.env.SENTRY_DSN!)`, call `.init()` once at boot |
| **Durable job queue** | `PgBossJobQueue` when `JOB_QUEUE_DATABASE_URL` is set; `InMemoryJobQueue` otherwise (dev/test) | **Yes — and now wired and started.** `createJobQueueFromEnv()` selects it; the worker process (`src/worker.ts`, `pnpm start:worker`) registers every handler via `lib/queue/job-registry.ts` and calls `.start()` | `lib/queue/default-job-queue.ts` | Nothing left to write. Set `JOB_QUEUE_DATABASE_URL` on **both** the Vercel project and the worker host, and deploy the worker (§5). With it unset, jobs still "run" inside the HTTP process and on Vercel are killed when the response returns |
| **Billing** | `NullPaymentProvider` | **Yes** — `StripeProvider` written and wired | `lib/billing/payment-provider.ts` (`createPaymentProviderFromEnv`) | Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, and create one recurring Stripe Price per paid tier with `lookup_key` = the plan slug (`starter`/`growth`/`pro`/`agency`/`managed`/`enterprise`). See the caveat below. |
| **SEO data** | `NullSEODataProvider` | No — needs writing | `lib/seo/seo-data-provider.ts:176` | Write a real class against Search Console / DataForSEO / Semrush / Ahrefs / Serper (the file's own comment names these as the original candidates) |
| **CMS publishing** | `NullPublishTarget` | Intentionally out of scope — no real external CMS integration was ever meant to exist in this build | — | Not a go-live blocker, a future epic |

> **Stripe caveat — the one thing still genuinely missing for "a customer can pay."**
> `StripeProvider` creates real customers, subscriptions, plan changes,
> cancellations and verifies real webhook signatures. But the
> `PaymentProvider` interface has no method that can hand a card-collection
> secret (a Stripe Checkout URL or a PaymentIntent client secret) back to the
> frontend, and no UI asks for card details. So
> `POST /api/orgs/me/subscription/upgrade` creates the Stripe subscription
> with `payment_behavior: 'default_incomplete'` — it exists, and it is
> `incomplete` until its first invoice is paid out of band (e.g. an invoice
> Stripe emails, or a Checkout session created manually). Turning that into
> self-serve checkout means ADDING a method to the interface plus a frontend
> payment page — a deliberate, separate decision, not an oversight in this
> adapter.
>
> **Billing dunning emails still do not send.** `routes/billing-webhooks.ts`
> handles the state machine's `send_email` side effects (payment failed
> 1st/2nd/final, downgrade notice, cancellation notice) with a `console.log`,
> not the `EmailSender`. Wiring it needs a product decision this build
> deliberately declined to guess at — which member of an org receives a
> billing email (see `lib/notifications/notify.ts`'s header on why "just
> email the owner" was not invented). A customer whose card fails currently
> gets no email.

---

## 4. Fake / demo data — what's already gone, what to double-check

- CRM's old `fixtures.ts` was deleted this session — the frontend is fully wired to the real API, nothing fake ships there.
- The Overview dashboard and Settings → Team tab (also wired this session) pull from real endpoints, no fixture fallback.
- `data/fixtures.ts` in `apps/web` still exists and is imported in **15 files** (`git grep -l 'from "@/data/fixtures"' src/` — onboarding, actions, competitors, CRM, SEO/website intelligence, every Settings panel, the org-switcher, and the user menu). Every occurrence checked is `currentUser`/`currentOrganization` only — never a source of fake leads, deals, scores, or any other business data; this is app-wide "who am I / what org am I acting as" identity plumbing, not a data leak. But it's broader than a couple of leftover spots, and it means there's no single real "current session" hook yet — each screen independently imports the same fixture constant. **Worth a real pre-launch decision**: either accept this (it works today because these fixture values happen to resolve correctly for the common single-org case, same interim pattern the Team panel wiring used deliberately this session for `GET /auth/me`), or build one real `useCurrentUser()`/`useCurrentOrg()` hook backed by the real session and replace all 15 call sites before launch, especially for any user who belongs to more than one organization.
- No seed script exists for anything except billing plans (§1.3) — there is no "demo org" or "demo brand" seeded anywhere; a fresh production database starts genuinely empty.

---

## 5. Deployment target — decided: Vercel for HTTP, a persistent host for the worker

> **Correction (2026-09-25).** This section previously said "nothing in
> `platform/` targets Vercel — no `vercel.json` exists anywhere under it" and
> framed the deployment target as an open question. Both halves were wrong.
> `platform/apps/api/vercel.json` exists and rewrites every path to
> `/api/index`; `platform/apps/api/api/index.js` is the serverless entry that
> adapts Hono's fetch handler to Node's request/response (Vercel project
> `bebest-api`, root directory `platform/apps/api`). `apps/api` has been
> deployed as serverless functions the whole time. `pnpm start`
> (`node dist/server.js`) is also still broken on its own terms: `build.mjs`
> emits `dist/app.cjs` and `dist/worker.cjs`, never `dist/server.js`.

### The split

`apps/api` is deployed **twice from one codebase**, because the two halves have
irreconcilable runtime needs:

| Process | Where | What it does | Entry |
|---|---|---|---|
| **HTTP** | Vercel serverless (project `bebest-api`) | Serves every route. Only ever ENQUEUES jobs — it registers no job handlers | `apps/api/api/index.js` → `dist/app.cjs` |
| **Worker** | A persistent host (Railway / Render / Fly.io / a container / a VM) | Consumes the pg-boss queue and runs every job to completion | `pnpm --filter @bebest/api run start:worker` → `dist/worker.cjs` |
| **Web** | Vercel | Next.js frontend, no special constraint | — |

Why it has to be this way: an AI Visibility baseline run is ~1,400 prompts x 4
models (x competitors) — thousands of AI calls and hours of wall time. A
serverless invocation is frozen the instant the response returns and capped in
the seconds-to-minutes range regardless, so before this split a run returned
`202` and then died, leaving its `ai_runs` row `running` forever. That is the
flagship feature of the product, and it could not complete. Moving the whole
API to a persistent host was considered and rejected — the HTTP side works well
on Vercel; only the jobs need a process that stays alive.

### How registration is split

Handlers must be registered in the worker and NOT in the HTTP process (a
registered handler on a durable queue means pg-boss `work()`, i.e. actively
claiming jobs this process cannot finish). One environment variable decides:

- `lib/queue/job-types.ts` is the canonical list of every job type. Nothing
  else may name a job type: a source scan in `lib/queue/job-registry.test.ts`
  fails the suite on any `enqueue()` that does not use `JOB_TYPES.*`.
- `lib/queue/job-registry.ts` maps each declared type to its handler and
  `assertJobHandlerCoverage()` **refuses to start the worker** if any declared
  type has no handler, naming it. Adding an enqueue without a consumer is
  therefore a failed test and then a failed boot, never a silently unclaimed
  job.
- `lib/queue/register-in-process.ts` keeps the old single-process behaviour for
  `pnpm dev` and the test suite, and becomes a no-op as soon as
  `JOB_QUEUE_DATABASE_URL` is set.
- `JOB_POLICIES` (same file as the job types) sets each job's
  `expireInSeconds`/`retryLimit`. This is not tuning: pg-boss's default
  `expireInSeconds` is **15 minutes**, after which it treats the worker as dead
  and re-dispatches the job. An hours-long AI Visibility run on that default
  would have several copies of itself running at several times the AI spend. The
  three expensive jobs also have `retryLimit: 0` — nothing here can resume a
  partial run, so an automatic retry means re-paying for thousands of AI calls
  (or, for an agent run, re-executing actions already taken on a customer's
  site). A failed run is marked `failed` for a human to retry deliberately.

### What a human has to provision

1. A persistent host for the worker. Build command
   `pnpm install && pnpm --filter @bebest/api run build`, start command
   `pnpm --filter @bebest/api run start:worker`. One instance is enough to
   start; pg-boss's locking makes more than one safe (each job is claimed
   once), and horizontal scale is how throughput grows later.
2. `JOB_QUEUE_DATABASE_URL` on **both** the Vercel `bebest-api` project and the
   worker host — pointing at the same database. If only one side has it, the
   enqueuing side and the consuming side are looking at different queues.
   (Normally the same connection string as `DATABASE_URL`; pg-boss creates and
   owns its own `pgboss` schema on first `start()`.) The role needs CREATE on
   the database for that first run.
3. The worker's own environment: see §2's worker table. AI provider keys and
   `RESEND_API_KEY` matter more there than on Vercel — the worker is what makes
   the model calls and sends the snapshot-ready email.
4. A SIGTERM→SIGKILL window above 20 seconds on the worker host (Railway, Fly
   and Render all default to ~30s, which is fine). On SIGTERM the worker stops
   fetching, gives in-flight handlers that window, then marks whatever is still
   running `failed` (`releaseOnShutdown`) so no `ai_runs`/`crawl_jobs`/
   `agent_runs` row is left `running` with nothing alive to finish it, and
   exits. A deploy mid-run therefore produces a visibly failed, retryable run
   rather than a permanently hung one.
5. Worker logs and alerting. It is a process nobody is watching by definition:
   `worker_released_in_flight_jobs`, `pgboss_job_queue_handler_failed` and
   `pgboss_job_queue_undeclared_job_type` are the lines worth alerting on.

### Still open

- **Restarting a released run is manual.** `releaseOnShutdown` marks the run
  `failed`; nothing automatically re-enqueues it, and pg-boss's own retry of
  the job would restart the pipeline from the beginning rather than resuming.
  Resumable runs are a separate piece of work.
- ~~`lib/measurement/schedule-remeasurement.ts` is the one background path not
  on the queue — an in-process `setTimeout` that never fires on serverless.~~
  **Fixed.** It is now the fifth job type (`remeasurement`), enqueued with a
  four-week `delayMs` so the wait lives in Postgres rather than in a timer
  belonging to a frozen function. The 32-bit `setTimeout` ceiling that forced
  the old chunked implementation is gone with it. It is the one job with no
  `releaseOnShutdown`, because it writes nothing until it succeeds — so a killed
  worker leaves no partial state — and it carries `retryLimit: 1` so the attempt
  is not lost. `job-registry.test.ts` holds an allowlist for that exemption, so
  a future job cannot quietly omit a release path.

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
- ~~`POST /auth/refresh` doesn't re-attach the previously-selected org~~ — **fixed 2026-09-09.** `/auth/refresh` now accepts an optional `orgSlug` and re-derives access from `memberships` (then agency links) before putting the org on the new token, and the web client sends the org it last acted as. It is a request, not a grant: a slug the caller cannot reach yields an org-less token, same as before. The magic-link verify page now also selects an org after login — previously nothing did, so every org-scoped route answered 409 straight after a successful sign-in.
- CRM's SSRF guard validates URLs at write time only — inert today since nothing fetches a stored CRM URL yet, but any future feature that does must add its own fetch-time guard.
- No OpenAPI/generated API docs — routes are documented in prose (`apps/api/README.md`) only.
- **AI cost metering is live but its prices are unverified.** Every model call now writes an `ai_usage` row (tokens in/out, `cost_usd`, latency, finish reason) from the adapter boundary — `apps/api/src/lib/ai-usage/metered-provider.ts`, wired via `getMeteredAiProviderRegistry()`. The per-model rates in `packages/ai-provider/src/pricing.ts` are realistic public list rates committed as a starting point; **nobody has checked them against the providers' pricing pages yet** (`PRICING_LAST_VERIFIED` is `null`). Costs are usable for internal margin analysis, not for anything customer-facing, until that pass is done.
- **`PerplexityProvider.healthCheck()` is a real billed request.** It sends a `max_tokens: 1` completion, and Perplexity charges a flat per-request search fee. `healthCheck()` returns a bare boolean with no usage metadata, so that spend cannot be metered — and `registry.healthCheckAll()` from a frequently-polled status endpoint would bill on every poll. Either rate-limit/avoid exposing `healthCheckAll()` publicly, or give Perplexity a non-billing probe.
- **Anonymous free-snapshot AI spend is attributed to the internal CRM org.** A free snapshot has no `organizations` row, and `ai_usage.organization_id` is `NOT NULL` with RLS on both read and write, so that spend is recorded under `CRM_INTERNAL_ORG_ID` rather than dropped. It is therefore visible in aggregate (that org's `ai_usage` rows) but not attributable to an individual lead, and it is indistinguishable from any AI spend BeBest's own internal tenant makes. Splitting the two needs a `feature` (or `snapshot_request_id`) column on `ai_usage` — the attribution is already threaded through in code (`AiUsageAttribution.feature`), so that is a migration plus one `data:` line.
- **Metering measures; it does not yet enforce.** Plan limits still cap query COUNTS, not dollars (`plans.limits`, `lib/entitlements.ts`). A customer can still spend more on model calls than their subscription is worth — the sensor now sees it, nothing stops it. Dollar-based entitlements, a response cache, and a pre-flight run cost estimator are a deliberate follow-up.
- **`ai_usage` has no live-database tenant-isolation proof yet.** Its RLS policy predates this work (`0000_init/rls.sql`), and the write path's org scoping is unit-tested, but the six real-RLS scenarios are `it.todo` in `routes/tenant-isolation.integration.test.ts` along with the other 79.

---

## 7. Final pre-launch checklist

> **Before shipping any change from here on: build the artifact and run it.**
> `node build.mjs && node dist/worker.cjs` (and the app entry). This is not
> belt-and-braces. On 2026-09-25 typecheck, lint and 1156 tests were all green
> while `dist/worker.cjs` crashed on its first line — `load-env.ts` read
> `import.meta.url`, which esbuild compiles to an undefined property in CJS
> output. Every gate in this repo exercises the TypeScript source; nothing
> exercised the bundle, so a dead entrypoint looked perfectly healthy. Any bug
> that lives only in the build output is invisible to the whole test suite.

- [ ] Built artifacts run: `node build.mjs`, then start `dist/app.cjs` and `dist/worker.cjs` and confirm each reaches its own startup checks
- [ ] **One real job completes from `dist/worker.cjs`.** Booting is not enough and has already proved it twice: `load-env.ts`'s `import.meta.url` killed the bundle on its first line, and the prompt templates resolved to a non-existent directory in the bundle — that one let both artifacts boot cleanly while 100% of AI jobs died on their first template load, immediately after the run row had been marked `running`. Run an actual AI Visibility run against the built worker and watch it reach `completed`
- [ ] Postgres provisioned, `DATABASE_URL` set
- [ ] `pnpm --filter @bebest/database run db:apply` run (schema + every folder's constraints, indexes and RLS — see §1.1; `prisma migrate deploy` does **not** do this)
- [ ] **Drain the AI-visibility queue before applying `0023_ai_run_cost_preflight`.** Runs already queued carry no price, and the new guard fails closed — they will fail with `RunNotPricedError` rather than execute unpriced. Let the queue empty, apply, then re-dispatch anything outstanding. This only bites on the one deploy that crosses 0023
- [ ] After `0024_billing_webhook_ordering`: confirm `bebest_app` can `SELECT … FOR UPDATE` on `subscriptions` under RLS — the webhook handler now serializes concurrent Stripe deliveries with a row lock, so a role that cannot take it breaks billing rather than degrading it
- [ ] `bebest_app` / `bebest_admin` Postgres roles created correctly (no `BYPASSRLS`, no ownership on `bebest_app`)
- [ ] `pnpm --filter @bebest/api run seed:plans` run
- [ ] Internal CRM org bootstrapped (`pnpm --filter @bebest/api run seed:dev`), `CRM_INTERNAL_ORG_ID` set
- [ ] `pnpm --filter @bebest/api run smoke:crm` passes against the deployed API
- [ ] 79 tenant-isolation integration tests run against the real database and passing
- [ ] `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` generated and set (real keys, not the dev pair)
- [ ] `APP_URL` set to the real production domain
- [ ] At least one real AI provider key set
- [ ] **AI pricing verified**: every entry in `packages/ai-provider/src/pricing.ts` checked against the provider's current public pricing page, `PRICING_TABLE_VERSION` bumped and `PRICING_LAST_VERIFIED` set (it is `null` today — costs are unverified estimates until then)
- [ ] `CRM_INTERNAL_ORG_ID` set **before the free-snapshot flow is opened to traffic** — without it, anonymous snapshot AI spend is logged (`ai_usage_write_skipped_no_org`) but not recorded
- [ ] A cost report / dashboard reads `ai_usage` (nothing does yet — the rows are written but nothing surfaces them)
- [ ] `NODE_ENV=production` set
- [ ] Worker deployed to a persistent host (§5) — `pnpm --filter @bebest/api run start:worker`, with the worker env from §2, and a SIGTERM→SIGKILL window above 20s
- [ ] Email: `RESEND_API_KEY` + `EMAIL_FROM` set and the sending domain verified in Resend (the sender itself is written and wired)
- [ ] Error tracking: `SentryErrorTracker` wired and started, or accept console-only logging until it is
- [ ] Durable job queue: `JOB_QUEUE_DATABASE_URL` set on **both** the Vercel `bebest-api` project and the worker host, pointing at the same database (the code itself is wired and started — see §5). Verify on the first deploy that `worker_started` appears in the worker's logs listing all **5** job types (`ai_visibility_run`, `crawl_job`, `agent_run`, `free_snapshot_pipeline`, `remeasurement`), and that a triggered AI Visibility run reaches `completed` rather than sitting in `running`
- [ ] Alerting on the worker's `worker_released_in_flight_jobs`, `pgboss_job_queue_handler_failed` and `pgboss_job_queue_undeclared_job_type` log lines
- [ ] Accept (or schedule work for) the 4-week re-measurement trigger not firing — it is still an in-process `setTimeout`, not a queued job (§5)
- [ ] Billing: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set, one Stripe Price per paid tier created with `lookup_key` = plan slug, webhook endpoint pointed at `POST /api/webhooks/billing` (the provider itself is written and wired)
- [ ] Billing: decide how a card actually gets collected — see §3's Stripe caveat; a new paid subscription is created `incomplete` and nothing in the product collects payment details yet
- [ ] `NEXT_PUBLIC_API_URL` (frontend) pointed at the real deployed API
- [ ] Decide on `data/fixtures.ts`'s 15 remaining `currentUser`/`currentOrganization` call sites (§4) — accept the single-org-user interim pattern, or replace with a real session-backed hook before launch (especially before onboarding any multi-org user)
