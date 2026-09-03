# Session Log — Cencrest Ventures

## Session: 2026-08-10

### Context
First Claude Code session on this project. Bootstrapped CLAUDE.md, session.md, and plan.md from a full codebase read.

### What was established
- Full project context captured in CLAUDE.md
- Project plan written in plan.md
- Site is a single-page HTML/CSS/JS marketing site, no framework
- Deployed to Vercel under project ID `prj_d8K4mXv4lonhRGRG9ICizJXroLNK`

### State of the site (as of Aug 8 2026)
- All 11 sections present and structured
- `design-bible.html` exists as a separate design reference document
- No backend — apply form uses `alert()` as placeholder (no real submission)
- `hero-film.js` is the largest file (18KB) — handles hero animation/film grain
- `source-field.js` handles the 340-node canvas visualization in Section 04
- `interactions.js` handles scroll, input sizing, nav effects

### Open items / known gaps
- Apply form has no real backend — submissions go nowhere
- Research index entries (Section 10) are static placeholders, not real articles
- No mobile-specific testing noted
- No analytics or tracking wired up

---

## Session: 2026-08-28 to 2026-08-29 — BeBest API Backend Build

### Stack decided
- Node.js v24 / TypeScript / Hono framework
- Prisma ORM (PostgreSQL 16 on port 5434)
- Vitest for tests
- Resend for email
- Supabase (planned, not yet wired)
- Deployed target: Vercel

### API location
`/api/` subfolder in this repo. Entry: `api/src/index.ts`. Server: `api/src/server.ts`.

### Known operational notes
- `npm install` must use `--cache /tmp/npm-cache-bebest` (root npm cache owned by root)
- After every `prisma db pull`, re-apply @ignore attrs with sed commands (brand_categories, query_set_questions)
- PostgreSQL trust auth, no password, port 5434
- Dev auth bypass: `X-User-Id` header (non-production only)

---

## Epic Progress Tracker

| Epic | Title | Status | Tests | Committed |
|------|-------|--------|-------|-----------|
| 0 | Repository Audit & Product Specification | ✅ Done | — | Pre-existing |
| 1 | Platform Foundation | ✅ Done | ✅ | Yes |
| 2 | Organizations / Users / RBAC | ✅ Done | ✅ | Yes |
| 3 | Authentication / Security | ✅ Done | ✅ | Yes |
| 4 | Brand Intelligence | ✅ Done | ✅ | Yes |
| 5 | Website Intelligence (Crawler) | ✅ Done | ✅ | Yes |
| 6 | SEO Intelligence (Keywords) | ✅ Done | ✅ | Yes |
| 7 | Intent & Query Intelligence | ✅ Done | ✅ | Yes |
| 8 | AI Provider Abstraction | ✅ Done | ✅ | Yes |
| 9 | AI Visibility Engine | ✅ Done | ✅ | Yes |
| 10 | AI Response Intelligence | ✅ Done | ✅ | Yes |
| 11 | Competitive Intelligence | ✅ Done | ✅ | Yes |
| 12 | Unified SEO + GEO Opportunity Engine | ✅ Done | ✅ | Yes |
| 13 | GEO Gap Engine | ✅ Done | ✅ | Yes |
| 14 | Recommendation Engine | ✅ Done | ✅ | Yes |
| 15 | Content Intelligence | ✅ Done | ✅ | Yes |
| 16 | Content Generation | ✅ Done | ✅ | Yes |
| 17 | GEO Agent | ✅ Done | ✅ | Yes |
| 18 | SEO Agent | ✅ Done | ✅ | Yes |
| 19 | Unified Growth Agent | ✅ Done | ✅ | Yes |
| 20 | Action Center | ✅ Done | ✅ | Yes |
| 21 | Controlled Publishing | ✅ Done | ✅ | Yes |
| 22 | Measurement & Experimentation | ✅ Done | ✅ | Yes |
| 23 | Continuous Learning Loop | ✅ Done | ✅ | Yes |
| 24 | Reporting | ✅ Done | ✅ | Yes |
| 25 | Notifications | ✅ Done | ✅ | Yes |
| 26 | Billing | ✅ Done | ✅ | Yes |
| 27 | CRM | ✅ Done | ✅ | Yes |
| 28 | Free AI + SEO Snapshot | ✅ Done | ✅ | Yes |
| 29 | Customer Success Automation | ✅ Done | ✅ | Yes |
| 30 | Agency / Multi-client | ✅ Done | ✅ | Yes |
| 31 | White Label | ✅ Done | ✅ | Yes |
| 32 | Integrations | ✅ Done | ✅ | Yes |
| 33 | Marketing / Growth Engine | ✅ Done | ✅ | Yes |
| 34 | Entrepreneur Story Ecosystem | ✅ Done | ✅ | Yes |
| 35 | Autonomous Operations | ✅ Done | ✅ | Yes |
| 36 | Production Hardening | ✅ Done | ✅ | Yes |

### Test count history
| Commit | Tests |
|--------|-------|
| Epics 1-3 (Foundation, Orgs, Auth) | ~30 |
| Epic 4 (Brands) | 41 |
| Epic 5 (Crawler) | 49 |
| Epic 6 (Keywords) | 60 |
| Epic 7 (Journeys) | 70 |
| Epics 8+26+32 (AI, Billing, Integrations) | 94 |
| Epics 9+27 (Visibility Engine, CRM) | 115 |
| Epics 10+25 (Response Intelligence, Notifications) | 138 |
| Epics 11+28 (Competitive Intelligence, Snapshot) | 158 |
| Epic 12 (Opportunity Engine) | 164 |
| Epic 13 (GEO Gap Engine) | 171 |
| Epic 14 (Recommendation Engine) | 178 |
| Epic 15 (Content Intelligence) | 189 |
| Epic 16 (Content Generation) | 201 |
| Epics 17+18 (GEO Agent + SEO Agent) | 215 |
| Epic 19 (Unified Growth Agent) | 223 |
| Epic 20 (Action Center) | 234 |
| Epic 21 (Controlled Publishing) | 247 |
| Epic 22 (Measurement & Experimentation) | 259 |
| Epics 23+24 (Learning Loop + Reporting) | 279 |
| Epics 29+30 (Customer Success + Agency) | 293 |
| Epic 31 (White Label) | 303 |
| Epics 33+35 (Marketing Engine + Autonomous Ops) | 328 |
| Epic 34 (Entrepreneur Story Ecosystem) | 338 |
| Epic 36 (Production Hardening) | 345 |

### ✅ ALL 37 EPICS COMPLETE

**Final state: 345 tests passing across 39 test files.**

### Known technical debt (still open)
- DB migrations done via raw psql — not reproducible without this exact DB
- Crawler + prompt runner use setImmediate, not a proper queue (pgboss)
- No CI/CD (no GitHub Actions)
- API not yet deployed to Vercel
- Rate limiting is in-memory only (not distributed — will not work across multiple instances)
- OpenAPI docs are a minimal stub, not exhaustive

### Known technical debt
- DB migrations done via raw psql (not Prisma Migrate) — not reproducible without this exact DB
- Crawler + prompt runner use `setImmediate` not pgboss queue
- No CI/CD (no GitHub Actions)
- API not yet deployed to Vercel
- Marketing site apply form still uses `alert()` — all leads lost
- No rate limiting on brand/crawl/keyword routes
- No OpenAPI docs

---

## Session: 2026-09-02 — Fresh clone + project subagents

### Context
New machine / new Claude Code session. Repo cloned fresh from `https://github.com/Nilkasar/cencrest-ventures.git` into `Documents/GitHub/cencrest-ventures`. No code changes made to `api/` or `web-app/` this session — this was an onboarding + tooling session.

### ⚠️ Discrepancy noticed — flag before trusting other docs
`PROJECT_STATUS.md` still says Phase 0 complete, all other phases "PLANNED," and epics 2–36 not started. That is **stale** — this file (session.md) and the git log show all 37 epics complete with 345 passing tests as of 2026-08-29 (see Epic Progress Tracker above), and `api/` + `web-app/` both exist with substantial code. **`PROJECT_STATUS.md` needs to be rewritten to match reality** — did not do it this session since it wasn't asked for, but next session should either fix it or explicitly decide to stop maintaining it.

### What was done
1. Cloned the repo (previously only existed on another machine).
2. Read through the full doc set (`PRODUCT_VISION.md`, `docs/05-architecture` through `docs/19-testing`, `DECISIONS.md`, `TECHNICAL_DEBT.md`, `web-app/AGENTS.md`/`CLAUDE.md`) to rebuild context from scratch.
3. Created four project-scoped Claude Code subagents in `.claude/agents/` (new directory — did not exist before) so future sessions can delegate to role-specific personas instead of re-explaining context every time:
   - **`growth-strategist`** — product/business owner (SEO, GEO/AEO, AI Visibility Score formula, Opportunity Engine, pricing/entitlements, epic sequencing). Enforces the rule: finish `api/` + `web-app/` before further marketing-site investment, except urgent lead-capture fixes (TD-001 / D-O10).
   - **`backend-architect`** — 20+yr backend lead for `api/` (Node/Hono/Prisma/Postgres, multi-tenancy + RLS, deterministic scoring, prompt versioning, SSRF/security, billing entitlements, agent execution model).
   - **`frontend-engineer`** — 15+yr UI/UX engineer for `web-app/` with Apple HIG-level craft standards (Next.js 16/React 19/Radix/GSAP stack, maps every screen to `docs/09-ux/CUSTOMER_JOURNEY.md`, accessibility, motion, empty/loading states).
   - **`qa-flow-tester`** — verifies flows end-to-end at production-grade quality **without a live DB connection** (traces code paths, checks test coverage against the Definition-of-Done in `docs/19-testing/TESTING_STRATEGY.md`, explicitly flags anything that genuinely needs a live database to confirm rather than rubber-stamping it).
4. Committed `.claude/agents/*.md` (commit `b7e1a5d`, local `main`). **Push was not completed** — this sandbox has read-only git access to the GitHub remote (clone/fetch works, push prompts for credentials that aren't available here). User was asked to push manually.

### Open items for next session
- Confirm `git push` of commit `b7e1a5d` happened.
- Decide whether to correct `PROJECT_STATUS.md` (see discrepancy above) or replace it with this session.md as the single source of truth for status.
- No functional work done on Epic 1+ this session — next session should pick up wherever the product build actually left off (verify against this file's Epic Progress Tracker, not `PROJECT_STATUS.md`).

---

## Session: 2026-09-02 (cont.) — Platform rebuild kickoff

### Context
User decided the existing `api/` + `web-app/` code, while functionally complete (37 epics, 345 tests per the tracker above), is not organizationally or visually production-grade: no monorepo, no clean domain boundaries, and a frontend that reads as "just another AI platform" rather than something built for the high-value customers (CMOs/founders paying $24k-$65k engagements) it serves. Decision: **full rebuild, in new folders, old code untouched until proven.**

### Decisions locked (via AskUserQuestion, all in this session)
- Git safety: rebuild happens on branch **`rebuild/platform`** (created off `main`, which was clean at branch time). Never commit to `main` during the rebuild. Never touch the live Vercel project or Supabase database. No force-push, no destructive git commands.
- Domain model: **port and harden**, don't discard — `api/prisma/schema.prisma` (2,201 lines, already matches `docs/06-database/SCHEMA.md`) is the starting point. `backend-architect` audits and refines anything weak (indexing for load, audit columns, constraints, RLS-as-migration-not-just-doc) rather than redesigning from zero.
- Monorepo tooling: **pnpm workspaces + Turborepo**.
- Build order: **epic by epic**, backend and frontend built together per epic (not backend-first), starting with **CRM**, ending with the **marketing site rebuild**, with a **final audit report** (done vs. pending) as the last step.
- **No database migrations are executed by Claude during this build** — schema/migration files are generated and committed, but applying them against any database (local or Supabase) is the user's own step, done once everything is built.
- No stopping between epics to ask permission — proceed continuously; the user reviews via this log and the git history on `rebuild/platform`.

### New structure created this session
```
platform/                    ← new monorepo, additive, does not touch api/ or web-app/
  apps/{api,web}/             (scaffolding started)
  packages/{database,config,types,ui}/
  package.json, pnpm-workspace.yaml, turbo.json, .gitignore
  EPICS.md                    ← epic-by-epic tracker for the rebuild (Epic 0-21, mirrors the
                                 original 37-epic roadmap consolidated, ends with Marketing Site
                                 Rebuild + Final Audit)
```
`packages/config` has the shared `tsconfig.base.json`, ESLint flat config, and Prettier config every app/package will extend.

Four project subagents already exist from the prior session (`.claude/agents/growth-strategist.md`, `backend-architect.md`, `frontend-engineer.md`, `qa-flow-tester.md`) and are being used for this build per the plan approved in plan mode (saved at the time to `C:\Users\nilesh.kasar\.claude\plans\moonlit-nibbling-matsumoto.md` on the machine running that session).

### Status at the end of this entry
Epic 0 (Monorepo & Platform Foundation) is **IN PROGRESS** — scaffold done, schema audit + auth/orgs/RBAC/multi-tenancy/audit-logging build starting next via `backend-architect`, with `frontend-engineer` starting the premium design system in parallel. This log will be updated again as each epic in `platform/EPICS.md` completes — treat `platform/EPICS.md` + this file together as the authoritative status, not `PROJECT_STATUS.md`.

---

## Session: 2026-09-03 — Epic 0 complete; Wave 1 (Epics 1, 2, 6) launched via Workflow orchestration

### Epic 0 — BUILT (migration pending), committed `5d853ca`

Both halves finished and were independently reviewed (spot-checked actual code, not just the agents' own summaries) before committing:

- **`@bebest/database`**: hardened port of the old 96-model schema — RLS enabled+`FORCE`d on 80 tenant tables, ~25 CHECK constraints, supplemental indexes, `created_by`/`updated_by` gaps filled, FK `ON DELETE` policy reviewed table-by-table, `role` enum widened to match `docs/08-security/SECURITY.md`. **Three real RLS design bugs found and fixed by manual reasoning, not tooling**: `memberships` needed an OR-based (user-or-org) policy; `organization_rate_limits` and `invitations` needed to be *excluded* from RLS entirely because they're queried before any tenant context can exist. Full reasoning in `platform/packages/database/DECISIONS.md`.
- **`@bebest/api`**: magic-link-only RS256 auth with rotating refresh tokens, RBAC-as-data matching the security doc's role matrix (role always re-read from DB, never trusted from the token), durable Postgres-backed rate limiting (replacing the old in-memory version), automatic audit logging. 90 passing vitest tests, zero live-DB dependencies; a dedicated `tenant-isolation.integration.test.ts` documents exactly which scenarios still need a real database to prove.
- **`@bebest/ui` + `@bebest/web`**: premium design system ("Ink" neutral + "Verdant" accent, Fraunces/Inter/JetBrains Mono, no blue/violet AI-SaaS gradient) with 15 accessible Radix primitives; full Next.js app shell, all 12 nav destinations (including a new CRM section) rendering real pages, not 404s. Verified clean typecheck/lint/build.
- **No database was ever connected to.** Migration files (`prisma/migrations/0000_init/{rls,checks,indexes}.sql`) are generated and committed; applying them is the user's own step (commands listed in `platform/docs/epics/00-platform-foundation-backend.md`).

### Specs written ahead (growth-strategist scoping passes)

`platform/docs/epics/{01-crm, 02-brand-intelligence, 03-website-intelligence, 04-seo-intelligence, 05-intent-query-universe, 06-ai-provider-abstraction}.md`. Two real gaps found in the original docs and resolved rather than left ambiguous: `docs/06-database/SCHEMA.md` never gives `accounts`/`deals` their own table definitions despite `docs/05-architecture/ARCHITECTURE.md` listing them — Epic 1's spec defines `accounts` as a view over `organizations` (not a duplicate entity) and specifies `deals` fresh. Same gap exists for the Website/SEO schema groups — resolved in Epics 3/4's specs the same way.

### Wave 1 launched via the Workflow tool (user explicitly asked for multi-agent orchestration with monitoring)

Dependency analysis: Epic 0 unblocks Epics 1 (CRM), 2 (Brand Intelligence), and 6 (AI Provider Abstraction) independently of each other — so they build **in parallel**, backend+frontend together per epic (Epic 6 is backend-only, no UI), with each epic's verification **pipelined** (starts the moment that epic's own build finishes, not gated on the other epics). 8 agents this wave: 5 build + 3 `qa-flow-tester`-persona verify agents, run at `effort: 'high'` for the verify pass. Run ID `wf_1530b217-fdb`. Custom subagent types from `.claude/agents/` are still not resolving as invokable `agentType`s in this session (same issue as earlier — likely needs a fresh session start) — personas are embedded directly in each agent's prompt instead, same workaround as Epic 0.

### Open items for next session
- Confirm Wave 1's results once the workflow completes (not done as of this entry).
- Still need to actually run `pnpm install` / migrations against a real database — explicitly the user's own step, never done by Claude in this build.
- Custom `.claude/agents/*.md` subagent types (`growth-strategist`, `backend-architect`, `frontend-engineer`, `qa-flow-tester`) should be re-checked in a fresh session — if they resolve there, future waves can use `agentType` directly instead of embedding personas in every prompt.

---

## Session: 2026-09-03 (cont.) — Wave 1 results + a mandatory end-to-end-flow standing rule

### Standing rule added mid-wave

User's instruction: verifying an epic route-by-route or component-by-component isn't enough to catch integration gaps. Every `platform/docs/epics/NN-*.md` spec now requires a numbered **"End-to-end flow"** section (cross-layer handoffs named explicitly: API → DB → UI → audit log) that `qa-flow-tester` must walk literally, not just verify each piece in isolation. Retrofitted into specs 01/02/06 (already mid-build at the time); every spec from 07 onward has it from the start. This rule immediately proved its worth — see below.

### Wave 1 results (commit `10fd70f`) — honest, not all green

- **Epic 6 (AI Provider Abstraction): VERIFIED, production-ready.** New `@bebest/ai-provider` package, 76 tests, zero live network calls. Only non-blocking notes (a documented per-call cost tradeoff on Perplexity's health check, and two issues in *other* epics' code it incidentally found while running cross-package verification commands — see below).
- **Epic 1 (CRM): built, 1 real bug found.** The deals-pipeline kanban board's "move to Lost" silently records a canned reason instead of prompting for a real one — only the separate Deal Detail screen did this correctly. Everything else (RBAC matrix, audit logging, SSRF-guarded lead URLs, transactional lead-conversion, tenant scoping, real frontend empty/loading/error states) held up under direct code inspection, not just the build agents' own claims.
- **Epic 2 (Brand Intelligence): built, more serious gaps found.** The onboarding wizard frontend was built entirely against `localStorage` and fixture data and was **never wired to the real backend API** that exists and works. The two sides' data contracts also disagree (industries as array vs. string, competitor priority as number vs. string enum, use-case `solution` vs `solutions[]`, missing `enterprise` plan tier on one side). qa-flow-tester also caught a build-breaking TypeScript error in `competitor-dialog.tsx` that fails `pnpm --filter @bebest/web build` outright. This is exactly the class of bug the new end-to-end-flow rule exists to catch — a route-by-route review of either side alone would have looked fine.

### Fix wave dispatched (Workflow `wf_5da1f309-501`, 3 agents in parallel, not yet reported in as of this entry)
1. Epic 1 kanban lost-reason dialog fix (frontend, small).
2. Epic 2 frontend↔backend wiring + data-contract reconciliation (decide the correct side against the actual spec text, not convenience) + the build-breaking TS fix + named tenant-isolation test stubs for the 5 new tables (combined backend+frontend, larger).
3. A flaky, order-dependent `@bebest/api` test (shared mutable state across test files — likely the in-memory rate limiter or an audit-log mock not resetting between files) found incidentally by Epic 6's verify agent while running cross-package checks.

### Open items for next session
- Confirm the fix wave's results and whether a re-verify pass is warranted before marking Epics 1/2 `VERIFIED`.
- Migration-folder numbering: Epic 1 and Epic 2 independently created `prisma/migrations/0001_*` concurrently; Epic 1 self-resolved by renumbering to `0002_crm` (confirmed on disk: `0000_init`, `0001_brand_intelligence`, `0002_crm` — no collision remains).
- Still nothing run against a live database — that remains entirely the user's own step.

### Fix wave landed (commit `481cc45`) — Epics 0, 1, 2, 6 all VERIFIED

All three fixes confirmed correct by direct code inspection (not just the fix agents' own claims) before updating status:
- **Epic 1**: `deals-board-view.tsx`'s kanban now opens a real shared reason-capture dialog before any "move to Lost" — spot-checked `handleMoveStage`/`applyStageChange`/`lostPromptDealId` state directly in the file.
- **Epic 2**: `onboarding-client.ts` now calls the real API; every data-contract mismatch was resolved by reading the actual spec text and fixing whichever side deviated (backend's `brands` table had drifted from `docs/06-database/SCHEMA.md`'s `industries[]/categories[]/markets[]`, competitor priority reverted to the spec's literal `SMALLINT`, plan tiers completed to the full 7-tier list) — spot-checked `schema.prisma`'s `brands` model directly, matches exactly. The reported build-breaking TS error wasn't reproducible (already clean).
- **Epic 0**: the flaky `@bebest/api` test (found incidentally by Epic 6's verify agent while running cross-package checks, not something anyone was looking for) was root-caused to `auth.test.ts` not restoring `NODE_ENV` in `afterEach` like every other env-mutating test file does — fixed, verified deterministic across 5 consecutive full-suite runs.

Epics 0, 1, 2, 6 are now `VERIFIED` in `platform/EPICS.md`. Migration application is still entirely the user's own step — nothing was run against a database.

### Wave 2 — next up

Dependency-driven: Epic 3 (Website Intelligence/Crawler) and Epic 5 (Intent & Query Universe) both only depend on Epic 2 (done) and not on each other, so they build in parallel next. Epic 4 (SEO Intelligence) needs both Epic 2 and Epic 3's schema to exist, and Epic 7 (AI Visibility Engine) needs both Epic 5 and Epic 6 — both deferred to Wave 3 rather than risking a three-way concurrent schema edit in one wave.

---

## Session: 2026-09-03 (cont.) — Wave 2 results reveal a systemic pattern; process changed

### Wave 2 results (commit `4e0f16f`) — same integration gap, twice more

Both Epic 3 and Epic 5 came back `needs-fixes` from qa-flow-tester, and **both had the identical failure mode Epic 2 had**: a genuinely solid backend (SSRF-safe crawler with real incremental progress, deterministic query-universe generator, both well-tested) and a genuinely well-designed frontend, built in parallel against each side's own invented fixtures, never actually wired together, disagreeing on field names/enums when checked (`status: pending` vs `queued`, `severity: critical/warning/info` vs `low/medium/high`, `errorMessage` vs `error`, etc.). Epic 5's backend also had two real logic bugs the verify pass caught: `PATCH /:id/activate` never archives a brand's previously-active query set (no single-active-set guarantee), and the entitlement cap was enforced on `POST /generate` but not on the manual-add endpoint, so a user could bypass their plan's query limit entirely.

**This is now a pattern, not a one-off** — three epics in a row hit the exact same class of bug from running backend and frontend fully in parallel against invented contracts.

### Process change: added a second standing rule to `platform/EPICS.md`

From Wave 3 onward, **backend builds first, then frontend wires directly against the real deployed routes** — no more parallel fixture-building where each side guesses the other's contract. This trades some wall-clock parallelism per epic for eliminating the bug class at the source instead of catching it after the fact every wave.

### Fix wave dispatched (Workflow `wf_e6fea498-e5d`, 2 agents in parallel — not yet reported in as of this entry)
1. Epic 3: wire `data/website/client.ts` to the real crawl/pages routes, fix the 4 enum/field mismatches, replace the fake 26-second progress timer with real polling of the backend's actual incremental counters.
2. Epic 5: wire `data/query-universe/client.ts` to the real query-sets routes, reconcile the contract (deliberately, per-field — add to backend if load-bearing for the UI, drop from frontend if not), fix the single-active-set bug, fix the entitlement-bypass bug.

### Wave 2 fixes landed (commit `74b3b93`) — Epics 3 and 5 now VERIFIED

Both fixes spot-checked directly in code (not just the fix agents' claims): Epic 5's single-active-query-set fix confirmed as one `withOrgContext` transaction (`updateMany` archiving every other active set for the brand, then activating the target — no window where two could be active). Epic 3's frontend now polls the real crawl-job counters instead of a fake timer. One small, honestly-flagged residual gap: Epic 3 has no `GET /brands/me/crawl-jobs` list route yet, so cross-session crawl history relies on a local job-id pointer list rather than a real list endpoint — left as a known minor gap, not silently hidden.

Notably, the Epic 5 fix agent caught that this repo's root `CLAUDE.md` (written for the old marketing-site project) has an "auto-commit/push/deploy" instruction, recognized it conflicted with this specific task's explicit "no git commands" constraint, and correctly followed the task instruction instead of the CLAUDE.md default — good instruction-precedence judgment worth noting.

Epics 0, 1, 2, 3, 5, 6 are now all `VERIFIED` in `platform/EPICS.md`.

### Wave 3 — next up

Epic 4 (SEO Intelligence, needs Epic 2+3 — both done) and Epic 7 (AI Visibility Engine, needs Epic 5+6 — both done) build next, in parallel with each other, each now using the new backend-first-then-frontend process (see `platform/EPICS.md`'s second standing rule) instead of the parallel-fixture approach that caused three straight rounds of rework.

### Wave 3 results (commit `f149fd9`) — process fix confirmed working

Both Epic 4 (SEO Intelligence) and Epic 7 (AI Visibility Engine) came back `production-ready` from qa-flow-tester on the FIRST pass — zero wiring gaps, versus 3 consecutive rounds of rework under the old parallel-fixture approach. Confirms the backend-first-then-frontend-wires-to-real-API standing rule (added after Wave 2) actually fixes the root cause rather than just the symptom.

Highlights: Epic 7's pipeline was verified to always persist the raw AI response before attempting extraction (evidence never lost even if extraction fails) and to always fan out GEO queries to all 4 real cloud providers, never silently defaulting to Ollama (spot-checked directly in `@bebest/ai-provider`'s `DEFAULT_TASK_DEFAULTS` myself). Epic 7's frontend delivers the full evidence drill-down the spec demands: score → formula components → observation → raw AI response text, not a bare number. Epic 4's opportunity list is server-sorted with zero client-side re-sort, matching the DB's own ordering. Both epics correctly disclosed their honest scope boundaries (no real paid SEO provider yet, no durable queue, no entitlement gating on SEO since none is documented) rather than hiding them.

Epics 0, 1, 2, 3, 4, 5, 6, 7 are now all `VERIFIED` in `platform/EPICS.md`.

### Wave 4 — next up

Epic 8 (Competitive Intelligence, needs Epic 7 — done) is the next dependency-unblocked item on the specced roadmap. Also starting Epic 16 (Billing) in parallel since it only depends on Epic 0 (done) and is fully independent of the SEO/GEO pipeline — writing its spec now to keep both build tracks fed.

### Wave 4 results (commit `e210fc5`) — both VERIFIED first pass, process fix holding

Epic 8 correctly reused Epic 7's pipeline (added a nullable `competitor_id` to `ai_runs` rather than building a parallel pipeline) — Share of AI Voice and the four gap types all tested at the documented boundary cases. Epic 16 did the harder job well: refactored `entitlements.ts` onto real seeded `plans`/`subscriptions` data while keeping the exact call signature Epics 2/5/7 already use, with a narrowly-scoped fallback (only fires when no subscription row exists) — spot-checked directly in `resolvePlanLimits` myself, confirmed it's not a second hardcoded map wearing a disguise. qa-flow-tester independently re-ran Epic 2/5/7's own entitlement tests inside the full suite (not trusting the backend doc's claim) and confirmed zero regression: 482/482 passing.

Epics 0, 1, 2, 3, 4, 5, 6, 7, 8, 16 are now all `VERIFIED`.

### Wave 5 — next up

Epic 9 (Opportunity Engine, needs Epic 4 + Epic 8 — both done) is ready. Writing Epic 17 (Free AI + SEO Snapshot) spec now to pair with it — Epic 17 needs Epic 1 (CRM) + Epic 7 (AI baseline), both done, and is high product value (it's the actual public lead-generation entry point `PRODUCT_VISION.md` describes, and ties together CRM/crawler/SEO/AI-visibility into one public, unauthenticated flow).

### All remaining specs written (commit `3432ab3`)

Wrote specs for Epics 12 (Agents), 13 (Action Center/Publishing), 14 (Measurement/Learning), 15 (Reporting/Notifications), 18 (Agency/White-Label/Integrations), 19 (Production Hardening) while Wave 5 built — every epic from 1 through 19 now has a written spec with the end-to-end-flow checklist. Notable calls made explicit in these specs rather than left ambiguous: Epic 12 hard-blocks autonomy Level 4 at the code level; Epic 13 requires a real guard clause against publishing without a prior approval timestamp (defense in depth against a crafted API call, not just normal-flow enforcement); Epic 14 requires snapshotting before-scores at approval time, not measurement time; Epic 18 extends multi-tenancy via an explicit `agency_clients` grant table without ever relaxing RLS itself; Epic 19 is scoped strictly to the real `// TODO`s every prior epic already flagged, not invented hardening work.

### Wave 5 results (commit `1f9eea4`) — both VERIFIED first pass

Epic 9's unified-opportunity score was mathematically proven (not just tested) to always be `>= max(seoOnly, geoOnly)` via a probabilistic-OR combine function. Idempotency, dismiss-then-recompute, and material-change reactivation all independently tested. Epic 17 (the actual public product entry point) proved rate-limiting and lead-creation both happen first via real call-order assertions, free-tier scoping (10 pages/50 queries) as genuine threaded parameters rather than hardcoded values, and a report token that's a SHA-256 hash of a 32-byte random value — spot-checked directly in `lib/tokens.ts`, never an enumerable database id.

Notable: Epic 9's verify agent found a genuine cross-epic build-breaking bug in Epic 17's code (a JSDoc comment whose embedded `*/` prematurely closed a block comment and corrupted the rest of the file) — confirmed it by temporarily patching and rebuilding, then restored the file byte-for-byte since fixing someone else's epic wasn't its job. The concurrent Epic 17 agent independently found and fixed the same bug. Good example of the verify-agent discipline working as intended: report what's found, don't overstep scope.

Epics 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17 are now all `VERIFIED` — 12 of 19 product epics done.

### Wave 6 — next up

Epic 10 (Recommendation Engine, needs Epic 9 — done) and Epic 18 (Agency/White-Label/Integrations, needs Epic 0 + Epic 16 — both done) build next in parallel.

### Wave 6 results (commit `4e6fd5c`) — both VERIFIED first pass, plus a real cross-cutting discovery

Epic 10 and Epic 18 both came back production-ready. Epic 18's verify agent did the deepest tenant-isolation re-tracing yet — independently confirmed the "revoking an `agency_clients` link immediately blocks the next request" test is a genuine two-request regression test (not rubber-stamped), and that the new authorization layer composes on top of Epic 0's RLS without ever relaxing it.

**Important discovery**: tracing the auth chain for Epic 18's "switch to client org" flow surfaced that `platform/apps/web/src/lib/api-client.ts` has never actually attached an `Authorization` header to any request — it was built (Epic 0) with a stale assumption ("read from an httpOnly-cookie backed session") that never matched what the backend actually implements (bearer-token-only JWT, no cookies, documented in Epic 0's own completion doc). This has silently been true through 6 full waves — no epic's verification caught it because none involve a live authenticated session, so every "frontend calls the real API" confirmation was accurate about the URL/method/body but never actually checked whether the request would be authenticated. Confirmed by reading `api-client.ts` directly myself.

Dispatched a dedicated fix (`wf_48ae002d-4d3`, not yet landed as of this entry) rather than patching it inside either epic — this is foundational, cross-cutting infrastructure work, not scoped to one epic. Login flow, token storage/attachment, refresh-on-401, logout, and org-switch token propagation are all in scope.

Epics 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18 are now `VERIFIED` — 14 of 19 product epics done.

### Open items for next session
- Epic 17's white-label-into-report gap (Epic 18's own flagged limitation) will resolve naturally once Epic 15 (Reporting) is built.

### Session/token fix landed (commit `87eb90c`)

New `lib/auth-state.ts` (access token in-memory only, refresh token in `localStorage`, cross-tab logout sync via `storage` events — tradeoff argued explicitly in the new `apps/web/DECISIONS.md`). `apiClient` now attaches `Authorization: Bearer` on every request and does single-flight refresh-on-401 with one retry — spot-checked directly in code (the dedup logic so concurrent 401s trigger exactly one `/auth/refresh` call, not one per request). Real magic-link request/verify flow wired (previously a stubbed fake wait), real logout, and Epic 18's flagged org-switch token gap closed. This was genuinely foundational — every epic's frontend from here on inherits a working auth layer instead of building on top of a silently-broken one.

### Wave 7 — next up

Epic 11 (Content Intelligence & Generation, needs Epic 6 + Epic 10 — both done) and Epic 12 (Agents, needs Epic 4 + Epic 7 + Epic 9 + Epic 10 — all done) build next in parallel.
