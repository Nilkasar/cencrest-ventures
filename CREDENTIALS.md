# BeBest Platform — Required Credentials

Collect all values here before go-live. Add to Vercel via `vercel env add <NAME> production`.

---

## API (`bebest-api` · `prj_mv6ktU2xjtHGoqJSRMLQPdwINAap`)

### ✅ Already set in production

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_PRIVATE_KEY` | RS256 private key — signs access + refresh tokens |
| `JWT_PUBLIC_KEY` | RS256 public key — verifies tokens |
| `RESEND_API_KEY` | Transactional email (magic links, snapshot reports) |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://app.bebestwithai.com` |
| `CRM_INTERNAL_ORG_ID` | UUID of the BeBest Operations org in the DB |
| `GOOGLE_OAUTH_STATE_SECRET` | HMAC secret for OAuth CSRF state tokens |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://bebest-api.vercel.app/api/integrations/google/callback` |

### ❌ Still needed

| Variable | Where to get it | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID | Create a Web Application credential. Register redirect URI: `https://bebest-api.vercel.app/api/integrations/google/callback` |
| `GOOGLE_CLIENT_SECRET` | Same credential as above | Keep secret — never commit |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Powers AI visibility queries (Claude) |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | Powers AI visibility queries (ChatGPT) |
| `PERPLEXITY_API_KEY` | perplexity.ai → Settings → API | Powers AI visibility queries (Perplexity) |
| `GOOGLE_API_KEY` | Google Cloud Console → APIs & Services → Credentials → API Key | Powers AI visibility queries (Gemini) |
| `SENTRY_DSN` | sentry.io → Project → Settings → Client Keys | Error monitoring — optional but recommended |
| `BILLING_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → Signing secret | Required when real Stripe is wired up |

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
