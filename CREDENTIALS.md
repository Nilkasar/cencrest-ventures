# BeBest Platform — Required Credentials

Collect all values here before go-live. Add to Vercel via `vercel env add <NAME> production`.

> **What this file is, and what it is not.** This is the *collection sheet*: the
> list of every variable the code actually reads, where to get each value, and
> whether it is required. It is deliberately not the deployment guide —
> `platform/GO_LIVE.md` owns the ordered runbook, the reasoning, and the
> verification steps, and this file links to it rather than restating it. If the
> two ever disagree about whether something is required, the code is the
> arbiter: every variable below was taken from a `process.env` read in
> `platform/apps/api/src` or `platform/packages/*/src`.
>
> **Reconciled against the code 2026-09-25.** The previous version listed 18
> variables; the code reads 32. The gaps were not cosmetic — two of the missing
> ones each take down a core feature silently (`OLLAMA_BASE_URL`,
> `JOB_QUEUE_DATABASE_URL`), and two more must be *absent* in production or they
> disable a security control.

---

## ⚠️ Read this before anything else — the three silent failures

These do not produce an error you will notice. Each one lets the system look
healthy while a core promise to the customer is quietly broken.

| Variable | If you get it wrong | Why it is silent |
|---|---|---|
| `OLLAMA_BASE_URL` | **Every AI Visibility run completes reporting a score of 0.** | Extraction routes to Ollama with **no fallback provider** (`provider-registry.ts`). Omitting the variable does not error — it defaults to `http://localhost:11434`, which does not exist on Vercel or the worker host. The pipeline turns each per-provider failure into a `failed_jobs` increment and carries on, so the run reaches `completed` with nothing extracted. **Not interchangeable with the other AI keys.** |
| `JOB_QUEUE_DATABASE_URL` | **Long jobs never finish.** | It is the single switch between the durable pg-boss queue and an in-process queue (`default-job-queue.ts`). Unset, the API runs jobs in-process — and a Vercel function is killed the moment it returns its response, so a multi-hour baseline run dies mid-flight. The worker refuses to start without it, which is the one loud part. |
| `ALLOW_DEV_AUTH_BYPASS` | **Anyone can authenticate as any user** via an `X-User-Id` header. | Must be **absent** in production. It is guarded by `NODE_ENV !== 'production'` (`middleware/auth.ts:35`), which makes `NODE_ENV=production` a load-bearing *security* setting, not a cosmetic one. Both have to be right. |

---

## Must NOT be set in production

| Variable | Why |
|---|---|
| `ALLOW_DEV_AUTH_BYPASS` | See above. Combined with a non-production `NODE_ENV`, it is a total auth bypass. |
| `SKIP_RLS_CHECK` | Disables the Row-Level Security gate — the only thing confirming tenant isolation is actually in force on the deployed HTTP path (`GO_LIVE.md` §5.1). It exists for a deliberately database-less boot. |
| `AUTONOMOUS_MODE` | Setting it has **literally zero effect**, and that is deliberate, not a gap. `lib/agents/autonomy.ts` hard-blocks agent autonomy level 4 and pointedly does not read this flag, because a guard that consulted the very flag meant to enable the thing it guards could be satisfied by setting it. Do not set it expecting to enable anything. |

---

## API (`bebest-api` · `prj_mv6ktU2xjtHGoqJSRMLQPdwINAap`)

### ✅ Already set in production

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string. Must be the `bebest_app` role — **not** an owner or `BYPASSRLS` role, or tenant isolation is silently off (`GO_LIVE.md` §1.2) |
| `JWT_PRIVATE_KEY` | RS256 private key — signs access + refresh tokens |
| `JWT_PUBLIC_KEY` | RS256 public key — verifies tokens |
| `RESEND_API_KEY` | Transactional email (magic links, snapshot reports) |
| `NODE_ENV` | `production`. Load-bearing for security — see the auth-bypass row above |
| `APP_URL` | `https://app.bebestwithai.com` |
| `CRM_INTERNAL_ORG_ID` | UUID of the BeBest Operations org in the DB |
| `GOOGLE_OAUTH_STATE_SECRET` | HMAC secret for OAuth CSRF state tokens |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://bebest-api.vercel.app/api/integrations/google/callback` |

### ❌ Still needed

| Variable | Required? | Where to get it | Notes |
|---|---|---|---|
| `OLLAMA_BASE_URL` | **Required** | The host running Ollama, e.g. `http://10.0.0.5:11434` | **Read the silent-failure table above.** Not optional and not interchangeable with the hosted model keys |
| `JOB_QUEUE_DATABASE_URL` | **Required** | A Postgres connection string for the pg-boss queue (the same Neon database is fine) | **Read the silent-failure table above.** Set it on the API *and* the worker |
| `ANTHROPIC_API_KEY` | **Required** | console.anthropic.com → API Keys | AI visibility queries (Claude) |
| `OPENAI_API_KEY` | **Required** | platform.openai.com → API Keys | AI visibility queries (ChatGPT) |
| `PERPLEXITY_API_KEY` | **Required** | perplexity.ai → Settings → API | AI visibility queries (Perplexity) |
| `GOOGLE_API_KEY` | **Required** | Google Cloud Console → Credentials → API Key | AI visibility queries (Gemini). This exact name — the code reads `GOOGLE_API_KEY`, and a Gemini key under any other name means the score is computed from 3 models while the site advertises 4 |
| `EMAIL_FROM` | Recommended | — | Defaults to `BeBest <hello@bebestwithai.com>`. Must be a domain verified in Resend or magic links will not deliver |
| `GOOGLE_CLIENT_ID` | For GSC/GA | Google Cloud Console → Credentials → OAuth 2.0 Client ID | Web Application credential; register the redirect URI below |
| `GOOGLE_CLIENT_SECRET` | For GSC/GA | Same credential as above | Keep secret — never commit |
| `STRIPE_SECRET_KEY` | For real billing | Stripe Dashboard → Developers → API keys | **Its presence is the switch** that selects the real `StripeProvider` over the deterministic no-network default (`payment-provider.ts`). Absent = nobody is charged |
| `STRIPE_WEBHOOK_SECRET` | For real billing | Stripe Dashboard → Webhooks → Signing secret | Preferred name. `BILLING_WEBHOOK_SECRET` is honoured as a fallback for the same purpose — set one, not both |
| `SENTRY_DSN` | Optional | sentry.io → Project → Settings → Client Keys | Error monitoring — recommended |

### Optional tuning (sensible defaults; set only to override)

| Variable | Default / purpose |
|---|---|
| `PORT` | `3001`. Only used by the self-hosted HTTP entrypoint (`pnpm start`), not by Vercel |
| `FREE_SNAPSHOT_DAILY_MAX` | Daily abuse cap on free snapshots (`lib/free-snapshot/abuse-caps.ts`). This is a direct AI-spend control — a low cap is the cheapest protection against a scripted flood |
| `PRISMA_DRIVER` | Set to `engine` to use the Prisma query engine instead of the Neon serverless driver |
| `DATABASE_POOL_MAX`, `DATABASE_POOL_IDLE_MS`, `DATABASE_CONNECT_TIMEOUT_MS` | Connection pool sizing |
| `DATABASE_TX_TIMEOUT_MS`, `DATABASE_TX_MAX_WAIT_MS` | Transaction timeouts |

### Google Cloud setup checklist (for `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
1. Create or open a Google Cloud project
2. Enable these APIs:
   - **Google Search Console API**
   - **Google Analytics Data API**
   - **Google Analytics Admin API**
3. OAuth consent screen → External → add scopes:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`
4. Credentials → Create → OAuth 2.0 Client ID → Web Application
5. Authorized redirect URIs: `https://bebest-api.vercel.app/api/integrations/google/callback`
6. Copy Client ID → `GOOGLE_CLIENT_ID`, Client Secret → `GOOGLE_CLIENT_SECRET`

---

## Worker — a fourth deployment, not a Vercel project

The API is deployed **twice from one codebase**: HTTP on Vercel, and a
persistent worker on a host that is not killed when a request ends (Railway /
Render / Fly.io / a container / a VM). See `GO_LIVE.md` §5 for why this split is
mandatory rather than an optimisation.

`vercel env add` does not reach the worker. Its variables are set on whatever
host runs `pnpm --filter @bebest/api run start:worker`, and it needs the same
set as the API — at minimum:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Same `bebest_app` role. RLS is in force here too |
| `JOB_QUEUE_DATABASE_URL` | **The worker refuses to start without it** |
| `OLLAMA_BASE_URL` | The worker is what actually runs AI jobs, so this matters most here |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_API_KEY` | Jobs run on the worker, so the model keys must exist on the worker |
| `RESEND_API_KEY`, `EMAIL_FROM` | The worker sends snapshot-ready email |
| `NODE_ENV`, `APP_URL`, `CRM_INTERNAL_ORG_ID`, `SENTRY_DSN` | Same values as the API |

---

## Web (`bebest-web` · `prj_S2ozhztzqAkLQPYTEO447pIwrcrT`)

### ✅ Already set in production

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://bebest-api.vercel.app` |

### ❌ Still needed

None at this time.

---

## Marketing site (`cencrest` · `prj_d8K4mXv4lonhRGRG9ICizJXroLNK`)

No credentials required — static HTML/CSS/JS, no server-side secrets.
