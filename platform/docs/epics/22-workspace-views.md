# Epic 22 — Workspace Views: Platform · Organization · Agency

Status: SPEC READY (2026-10-03). Decisions locked with the user:

| Decision | Choice |
|---|---|
| Platform access | Explicit staff flag: `users.platform_role` (`none` \| `support` \| `admin`), granted per person |
| Support "view as org" | Read-only, visible banner, every session audit-logged |
| Agency adds a client | Both: create a client org on the client's behalf, or link an existing org by invite |

## Why

Today every signed-in user gets the same sidebar. Customers see CRM (internal-only, 403s for them) and Agency; BeBest staff have no cross-org view at all; agencies manage clients one org at a time with no portfolio. This epic splits the app into three views chosen by who you are.

| View | Who | Routes | Scope |
|---|---|---|---|
| Platform | `users.platform_role` ∈ {support, admin} | `/platform/*` | All orgs, users, usage, health, leads, billing, capabilities |
| Organization | Any org member | existing `(app)` routes | Own org only |
| Agency | Members of an org with `organizations.kind = 'agency'` | `/agency/*` | Client portfolio + step into a client's Organization view |

## Phase 0 — Foundations

### Domain model (migration `0023_workspace_views`)
- `users.platform_role VARCHAR(20) NOT NULL DEFAULT 'none'` + CHECK (`none`,`support`,`admin`). Not tenant-scoped; `users` has no RLS.
- `organizations.kind VARCHAR(20) NOT NULL DEFAULT 'customer'` + CHECK (`customer`,`agency`,`internal`). Backfill: the `CRM_INTERNAL_ORG_ID` org → `internal`; orgs whose subscription plan has a non-zero `client_accounts` limit or that own any `agency_clients` row → `agency`.
- `platform_access_events` (append-only): `id, user_id, platform_role, action, target_org_id NULL, target_user_id NULL, request_path, method, created_at`. Every Platform API call writes one row, reads included.
- `support_sessions`: `id, staff_user_id, org_id, reason, started_at, ended_at NULL` — backs read-only "view as org".

### Session / API surface
- `GET /api/auth/me` adds `platformRole` and, per membership, `org.kind`; adds `agencyClients[]` for agency members. Web session context derives `views[]` (`platform` | `agency` | `org:<slug>`) and `activeView`.
- Org switching always re-mints the access token via `/select-org` (fixes switching back to the home org keeping the client token); the switcher lists every direct membership, not only agency clients.

### Cross-tenant access (Platform only)
- New `@bebest/database` export `platformDb`: a separate Prisma client on `PLATFORM_DATABASE_URL` whose Postgres role (`bebest_platform`) has read access across tenants. Created by `scripts/create-platform-role.sql`. Imported **only** under `apps/api/src/routes/platform/**` — enforced by an ESLint `no-restricted-imports` rule everywhere else.
- `requirePlatformRole(min)` middleware re-reads `platform_role` from the DB on every request (never trusted from the token) and writes `platform_access_events`.
- Customer routes, `withOrgContext` and RLS are unchanged; `assertRlsEnforced` continues to check the app role only.

### Web
- `middleware.ts`: unauthenticated requests to app routes redirect to `/login?next=…`; `/platform/*` requires `platformRole != none`; `/agency/*` requires an agency membership (server-checked again by the API).
- Sidebar config per view; view switcher at the top of the sidebar showing only permitted views. CRM and Agency entries removed from the Organization view.

### End-to-end flow (Phase 0)
1. Admin sets `platform_role='admin'` for a staff user (SQL in Phase 0; UI in Phase 4).
2. Staff user signs in → `/auth/me` returns `platformRole:'admin'` → switcher shows "BeBest Platform" plus their org.
3. Customer user signs in → `/auth/me` returns `platformRole:'none'` → no Platform entry; sidebar has no CRM/Agency; visiting `/platform` redirects to `/overview`; calling `/api/platform/*` directly returns 403 and writes no data.
4. Agency member signs in → switcher shows "Agency portfolio" + own org; switching to a client and back re-mints the token each time (verified by the `org` claim).
5. Signed-out visit to `/overview` redirects to `/login?next=/overview`; after sign-in lands on `/overview`.

## Phase 1 — Platform view

### API (`/api/platform/*`, all `requirePlatformRole('support')` unless noted)
- `GET /overview` — KPIs: orgs (by kind/plan/status), active users (7/30d), AI/agent runs today + failure rate, stuck jobs, new leads/snapshots (7d).
- `GET /capabilities` — the capability matrix: one entry per platform feature with `status` (`working` | `partial` | `blocked` | `stub`) and live dependency checks: AI providers (`healthCheckAll()`), Ollama, Resend, Google OAuth, Stripe, job queue, cron last-run, RLS enforced.
- `GET /orgs?q&kind&plan&status&page`, `GET /orgs/:id` (members, brand, subscription, usage vs limits, recent runs, audit trail).
- `GET /users?q&page`, `GET /users/:id`; `POST /users/:id/magic-link` (admin), `PATCH /users/:id` `{disabled}` (admin).
- `GET /agencies`, `GET /agencies/:id/clients`.
- `GET /jobs?type&status&org&page` across `crawl_jobs`, `ai_runs`, `agent_runs`, `snapshot_requests`; `POST /jobs/:type/:id/retry|cancel` (admin).
- `GET /audit?org&user&action&from&to&page` over `audit_events` + `platform_access_events`.
- CRM routes (`/leads`, `/deals`, `/accounts`, `/activities`, `/crm/users`) gated by `requirePlatformRole('support')` instead of `requireCrmAccess`; data stays in the internal org.

### Web (`/platform`)
Overview (KPIs + capability matrix) · Organizations (list + detail) · Users · Agencies · Growth (CRM leads/deals/accounts + free-snapshot requests) · Operations (jobs, failures, stuck, retry/cancel) · Audit log.

### End-to-end flow (Phase 1)
1. Staff opens `/platform` → `GET /api/platform/overview` + `/capabilities` → one `platform_access_events` row each.
2. Capability matrix shows AI providers as `blocked` when keys are missing (from `healthCheckAll()`, not a hardcoded list).
3. Staff searches an org → opens detail → sees members, plan, usage vs limits, last runs; the read is audited with `target_org_id`.
4. Staff opens Operations → filters `status=running` older than 30 min → cancels a stuck crawl → job row becomes `cancelled`, an `audit_events` row is written, the org's Website Intelligence screen shows the cancelled state.
5. Staff opens Growth → leads list (moved CRM) works exactly as before for staff; a customer calling the same API gets 403.

## Phase 2 — Organization view

- Settings hub: Organization profile (`PATCH /api/orgs/:slug` rename; `DELETE` owner-only with typed confirmation), Team, Billing, Connectors, Notifications (per-user email/in-app per event type), Autonomy (org default max level 1–3).
- `/invitations/accept?token=…` page → `POST /api/orgs/invitations/accept` → select org → `/overview`.
- First login: org slug made unique (suffix on collision); a user with an org but no brand is routed to `/onboarding`; onboarding completion stored server-side (`brands.onboarding_completed_at`); Done step starts the first crawl and query-set generation.

### End-to-end flow (Phase 2)
1. Owner invites a teammate → email link → `/invitations/accept` → membership created → teammate lands in the org's `/overview`.
2. Two users `john@a.com` and `john@b.com` sign up → both get their own org (`john`, `john-2`), both reach onboarding.
3. Completing onboarding on one device shows it complete on another; first crawl job and an active query set exist.
4. Rename org in Settings → switcher and header show the new name after refresh; audit row written.

## Phase 3 — Agency view

- `GET /api/agency/portfolio` — one row per active client: latest AVS and delta vs previous run, open opportunities, pending approvals, last run time, plan, `monthly_fee`, contract dates, access level. Computed by iterating linked clients under each client's own `withOrgContext` (no RLS bypass).
- `POST /api/agency/clients/create` — creates a client org (`kind='customer'`), an `agency_clients` row (`status='active'`, created by the agency), optional owner invite email; counts against `client_accounts`. Existing link-by-invite flow kept; the invited client gets an email + in-app notification.
- Step into client: Organization view for the client with a persistent banner ("Managing Acme · Back to portfolio"); `access_level` enforced server-side (`read_only` blocks all mutations, `limited` blocks billing/team/integrations).
- `GET /api/agency/queue` — pending approvals and drafts across all clients; `POST /api/agency/runs` (run AI visibility for selected clients); bulk report generation.
- White label applied: client reports, report emails, client invite emails use the agency's `white_label_configs`.
- Agency staff → client assignments (`agency_client_assignments`): which agency members may access which clients.

### End-to-end flow (Phase 3)
1. Agency creates "Acme" with owner invite → Acme org exists, link active, invite email sent with agency branding.
2. Portfolio shows Acme with no score → "Run" → AI run queued under Acme's org context → portfolio shows the score when complete.
3. Agency steps into Acme → banner visible → approves a draft (full access) → `audit_events` row attributes the agency user and `viaAgencyOrgId`.
4. Acme owner revokes the agency → the agency's next request for Acme is 403 and Acme disappears from the portfolio.
5. A `read_only` link: approve returns 403 and the UI hides mutating controls.

## Phase 4 — Platform admin actions
Comp a plan / override a limit, suspend / reactivate an org (suspended orgs get 423 on mutating routes), grant `platform_role` from the UI (admin only), read-only "view as org" via `support_sessions` (banner, auto-expire 60 min, every request audited, all mutations rejected), Stripe-backed revenue on the overview once billing is real.

## Dependencies and order
Phase 0 → 1 → 2 → 3 → 4. Durable background jobs + cron on Vercel run in parallel with Phase 1 (the Operations screen and capability matrix surface exactly what is broken). Build process per phase: backend first, frontend wires to the real API, qa-flow-tester walks the numbered end-to-end flow above.
