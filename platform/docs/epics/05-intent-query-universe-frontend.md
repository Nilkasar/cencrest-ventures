# Epic 5 — Intent & Query Universe (frontend half)

Written by: frontend pass against `docs/epics/05-intent-query-universe.md`. No backend for this epic exists yet in `platform/apps/api` (no `query-sets`/`queries` routes; `platform/apps/api/DECISIONS.md` has no mention of them) — this delivers the review-and-curate screen the spec's "UI surface" section calls for, entirely against typed in-memory fixtures, in the same posture Epic 1 (CRM)'s frontend took ahead of its backend.

## What shipped

- **Nav entry**: "Query Universe" — first item in the "Intelligence" nav group (`src/data/nav.ts`), ahead of AI Visibility and SEO Intelligence, matching the epics doc's framing of this as the shared foundation both growth engines consume. No `epic:` stub marker — this is a real screen, not a `<ComingSoon>` placeholder.
- **Route**: `apps/web/src/app/(app)/query-universe/page.tsx`.
- **Data layer** (`apps/web/src/data/query-universe/`):
  - `types.ts` — `QuerySet` (name/description/queryCount/version/status/planTier/planLimit/potentialCount) and `Query` (text/intentType/category/tags/priority/source), plus the ten `QUERY_CATEGORIES` in the exact order `docs/11-geo/GEO_ENGINE.md` numbers them.
  - `constants.ts` — category → label/pattern copy, category → `intent_type` mapping, category → default priority, status/priority/intent-type badge vocabulary, and `PLAN_QUERY_LIMITS` (the tier-cap table, mirroring `apps/api/src/lib/entitlements.ts`'s `PLAN_LIMITS` pattern).
  - `seed.ts` — a self-contained brand-profile fixture ("Northwind Logistics" — the same org as `data/fixtures.ts`'s `currentOrganization`, themed to the exact "freight visibility software" category `docs/10-seo/SEO_ENGINE.md`'s own Intent Graph example uses) with categories, competitors, features, geographies, and use cases (industry/company size/pain point/job-to-be-done) — the inputs the generator templates against.
  - `generator.ts` — the pure, deterministic template generator: ten category buckets built from the seed, interleaved round-robin, then capped at the plan's limit (so a cap always yields multi-category spread, never one category exhausted before the next is touched).
  - `client.ts` — the data-access seam (same shape as `data/crm/client.ts`): an in-memory `query_sets`/`queries` store behind a simulated network delay, with `fetchQueryUniverse`, `generateQuerySet`, `addQuery`, `removeQuery`, `activateQuerySet`, `archiveQuerySet`. `?bbDemoError=1` simulates a fetch failure (same convention as the CRM); `?bbDemoPlan=free|starter|growth|...` overrides the plan tier so the entitlement cap can be seen actually binding without a second fixture org.
- **Components** (`apps/web/src/components/query-universe/`): `query-universe-view.tsx` (orchestrator — loading/error/empty states, generate/activate/archive actions, category-grouped and flat-filterable tabs, version history), `query-set-summary-card.tsx` (status/version/cap meter/lifecycle actions), `category-section.tsx` (one category's block — the Intent Graph-style grouping), `add-query-dialog.tsx` (manual curation).

## Schema reconciliation (read before wiring a backend)

`packages/database/prisma/schema.prisma`'s ported `query_sets`/`questions`/`query_set_questions` tables do **not** match the epic spec's domain model:

| Spec (`05-intent-query-universe.md`) | Ported schema | Gap |
|---|---|---|
| `query_sets.status` (`draft\|active\|archived`) | *(no such column)* | No lifecycle state persisted at all. |
| `query_sets.version` | *(no such column)* | No version-freezing mechanism. |
| `query_sets.query_count` | *(no such column)* | Would need to be derived via `COUNT(query_set_questions)` or added as a column. |
| `queries` (one table, `query_set_id` FK) | `questions` (brand-scoped, no direct `query_set_id`) + `query_set_questions` (pure join, `@@ignore`d by Prisma Client — composite key, RLS enforced via raw SQL) | Queries belong to a brand and are *associated* to sets via the join table, not owned by exactly one set the way the spec's model implies. |
| `queries.intent_type` (`informational\|commercial\|comparison\|transactional`) | `questions.type` (`who\|what\|how\|best\|compare\|other` — a phrasing enum) + separate `intents.category` (`informational\|transactional\|navigational\|commercial` — only 4 of this epic's 10 generation categories, and on a *different* table) | Neither column is this epic's `intent_type`, and the ten generation categories (`category`/`problem`/`commercial`/.../`authority`) exist nowhere in the ported schema — they're this epic's own taxonomy, not a stored enum yet. |
| `queries.priority` | *(no such column)* | Not persisted. |

This frontend was built against the spec (`types.ts` documents this explicitly), the same posture `data/types.ts`'s `Brand`/`UseCase` comments describe for Epic 2's frontend vs. its own ported-schema gaps. **Backend work for this epic should implement toward `apps/web/src/data/query-universe/types.ts`, not treat the current Prisma schema as final** — at minimum, `query_sets` needs `status`/`version`/`query_count`, and either `questions` needs a direct `query_set_id` + `intent_type` + `category` (the 10-value one, not `intents.category`'s 4) + `priority`, or a new table replaces `questions`/`query_set_questions` outright. Flagging this now, not after a route handler is half-written against columns that don't carry what the UI needs.

## Design decisions

- **No live backend, self-contained fixture** — Epic 2's frontend (`onboarding-client.ts`) now calls the real `apiClient` against a running `apps/api`, but this epic's hard constraint is "no live backend." Rather than make this screen's demo-ability depend on Epic 2's backend being up, `seed.ts` is a standalone brand-profile fixture. `client.ts`'s doc comment marks the exact swap point once Epic 5's own backend exists.
- **Version lifecycle actually enforced client-side**, not just displayed: generating a new query set while a `draft` exists replaces it (with a confirm dialog — regenerating discards curated edits); activating a `draft` archives whatever was previously `active` for the brand (so exactly one `active` set exists at a time, per DoD #4's "must not silently mutate the same version other epics may already be referencing"); `active`/`archived` sets are read-only in the UI (add/remove controls are hidden, and `client.ts`'s mutation functions reject non-`draft` targets defensively even though the UI shouldn't offer the path).
- **Entitlement cap demonstrated, not just implemented**: the seed's template combinations (~70+ across all ten categories) exceed the Free tier's 50-query cap but not Growth's 500 — `?bbDemoPlan=free` lets a reviewer see "50 of 72 possible — capped by plan, upgrade to Starter" render for real, the same way `?bbDemoError=1` lets the CRM's error states be seen without a real outage.
- **`source: "generated" | "manual"`** on `Query` — not in the spec's DB columns, purely additive UI provenance so the curate screen visibly distinguishes what the generator produced from what a human added, per the epic's "the customer effectively co-owns this... not a black box" framing.
- **Grouped-by-category is the default view** (mirrors `docs/10-seo/SEO_ENGINE.md`'s Intent Graph tree example — a category heading over its queries); a second "All queries" tab gives the flat, `intent_type`/`category`-filterable list the spec's `queries: list (filterable by intent_type/category)` API surface calls for, in one screen instead of two.
- Manual additions are capped by the same `planLimit` as generation (`addQuery` throws `QueryLimitError` at the cap) — the spec's tier table describes the *query universe's* size, not just the generator's one-time output, so curation additions are entitlement-checked too.

## Verification

- `pnpm --filter @bebest/web typecheck` — clean.
- `pnpm --filter @bebest/web lint` — clean for every file this epic touched or added (`src/data/query-universe/**`, `src/components/query-universe/**`, `src/app/(app)/query-universe/page.tsx`, `src/data/nav.ts`). A pre-existing failure in `src/components/website/crawl-progress-panel.tsx` (concurrent Epic 3 work, `react/no-unescaped-entities`) is unrelated to this epic and was left untouched.
- `pnpm --filter @bebest/web build` — succeeds; `/query-universe` prerenders as a static route.
- `pnpm --filter @bebest/web test` — no test script exists for this app (same as every other frontend epic to date); no-op.
- Manually traced the full curate lifecycle against the fixtures: empty state → generate (spans all 10 categories, capped per plan) → remove one query + add one manual query (both persist, `queryCount` updates) → activate (`status` → `active`, `version` frozen, add/remove controls disappear) → regenerate a new draft → activate it (previous `active` set moves to `archived` and appears under "Previous versions") — the frontend analogue of the epic spec's numbered end-to-end flow, steps 1–4 and 6 (step 5, Epic 6/7 actually consuming an `active` set, is out of this epic's scope and blocked on the backend gaps above).

## Known gaps / next steps for the backend half

1. Implement `packages/database` migrations toward `types.ts`'s shape (see "Schema reconciliation" above) rather than the current `questions`/`query_set_questions` split.
2. Port `generator.ts`'s template logic (or an equivalent) server-side for `POST /brands/:id/query-sets/generate`, with the same round-robin-then-cap ordering so the DoD's "not just one or two templates applied repeatedly" check holds.
3. Wire `apps/web/src/data/query-universe/client.ts`'s five functions to real `apiClient` calls once the routes exist — every call site (`query-universe-view.tsx`) already goes through this seam, so no component changes should be needed.
4. `EntitlementLimitError`-style 402 handling: `apps/api/src/lib/entitlements.ts`'s `PLAN_LIMITS` needs a `queries_generated` (or similar) key added, mirroring `competitors_tracked`, per that file's own doc comment ("the brief for this epic explicitly calls out that Epic 4/5... need the identical shape").
