# Epic 19 — Production Hardening (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on every prior epic being built — this is a cross-cutting pass, not a new feature, and is deliberately scheduled last among the product epics (before the marketing site rebuild and final audit) so it addresses the REAL accumulated gaps every prior epic's own honest "what's not done" section already named, rather than guessing at hardening needs in the abstract.

## Why this epic

Every epic from 0 through 18 has, correctly and honestly, deferred the same handful of things with a `// TODO` marker: a durable job queue instead of `setImmediate`, distributed rate limiting, error tracking, real observability. This epic is where those accumulated, explicitly-tracked TODOs get resolved as a deliberate pass — not new scope, paying down real debt this build itself created on purpose (per `docs/16-billing/BILLING_ARCHITECTURE.md`/`docs/19-testing/TESTING_STRATEGY.md`'s own philosophy: build the interface correctly now, wire the durable implementation when it's actually needed).

## Concrete, named work (pulled from actual `// TODO` markers and completion-doc gaps across Epics 0-18 — do not invent hardening work not already flagged)

1. **Durable job queue** — replace every `setImmediate` placeholder (Epic 3's crawler, Epic 7's AI-run pipeline, Epic 14's measurement scheduler, Epic 12's agent runs) with pg-boss (already the documented choice per `session.md`'s prior-session notes and `DECISIONS.md`'s ADR list) or an equivalent, so a process restart doesn't strand jobs in `running` forever — a gap every one of those epics explicitly flagged.
2. **Rate limiting durability check** — Epic 0 already replaced the original in-memory limiter with a Postgres-backed one; audit that EVERY rate-limited endpoint added since (Epic 17's snapshot endpoint especially, being the highest-abuse-risk public route) actually uses it, not a leftover in-memory shortcut.
3. **Error tracking** — wire real error-tracking (Sentry or equivalent, per `docs/05-architecture/ARCHITECTURE.md`'s "Observability" table, marked "UNDECIDED/Not implemented") into `apps/api`'s existing `onError` handler and `apps/web`'s error boundaries, rather than the current console-only logging.
4. **Structured logging completeness** — confirm every route added since Epic 0 uses the established `requestLogger`/structured-JSON pattern, not ad hoc `console.log`.
5. **Crawl-jobs list endpoint** — Epic 3's own completion doc flagged a missing `GET /brands/me/crawl-jobs` list route (cross-session crawl history currently relies on a client-side pointer list) — a small, explicitly-named gap worth closing here.
6. **Load-relevant checks**: confirm pagination exists and is enforced (not just supported) on every list endpoint across all prior epics — a genuinely missed pagination limit is a real production incident waiting to happen once data volume grows, and is exactly the kind of thing a route-by-route audit catches that a single epic's own review might miss.
7. **Dependency/security audit**: run `pnpm audit` (or equivalent) across the whole monorepo and address anything high/critical — the only "new" check in this epic not sourced from a prior TODO, but a standard pre-production gate per `docs/08-security/SECURITY.md`'s "Dependency Security" section.

## Explicitly NOT this epic's job

Real external integrations (Stripe, Resend, Sentry SDK actually wired to a real account, Google Search Console OAuth) — those require real credentials this build environment doesn't have and shouldn't fabricate. This epic wires the CODE correctly (the abstraction, the call site, the interface) so plugging in a real credential later is a config change, not a code change — matching every prior epic's `NullXProvider` discipline.

## API surface

Mostly cross-cutting, not new routes — the one clearly new route is `GET /brands/me/crawl-jobs` (Epic 3's flagged gap).

## UI surface

No new screens — this epic's frontend-facing work is error-boundary quality (a broken request should never produce a blank screen or an unhandled promise rejection anywhere in the app) and confirming every list view added since Epic 0 has real pagination controls, not an unbounded fetch-everything call.

## End-to-end flow (qa-flow-tester must trace every step below — this epic IS the audit, so be exhaustive rather than sampling)

1. Grep the entire `apps/api/src` tree for `setImmediate` — confirm every remaining instance is either replaced with the durable queue or has a still-accurate, still-honest `// TODO` comment (not a stale one referencing an already-fixed epic).
2. Grep for direct `console.log`/`console.error` outside the established logging utilities — confirm every route uses structured logging.
3. Confirm every list endpoint across every epic enforces a page-size cap server-side (not just accepts a `limit` param the client could omit).
4. Confirm the new `GET /brands/me/crawl-jobs` endpoint exists and Epic 3's frontend can be updated to use it instead of the local pointer-list workaround (a small follow-up fix, not a new epic).
5. Run the dependency audit and confirm no unaddressed high/critical findings remain (or each is explicitly documented as an accepted risk with reasoning, not silently ignored).
6. Confirm error-tracking wiring doesn't leak sensitive data (stack traces, tokens) into whatever tracking service is configured — cross-check against `docs/08-security/SECURITY.md`'s "no leaked internals" principle.

## Definition of done

Every specific gap named above is either closed or has an explicit, current, accurate justification for remaining open — no silent scope creep, no silent gap-hiding either.
