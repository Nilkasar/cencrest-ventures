# Epic 10 — Recommendation Engine (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 9 (Opportunity Engine).

## Why this epic

`PRODUCT_VISION.md` Layer 4: opportunities identify *where* to act; recommendations say *what specifically to do*. This is the boundary where the product moves from "here's a gap" to "here's the exact page to build" — the difference between a rankings dashboard and a growth system, per the product's own "what BeBest is NOT" list.

## Domain model (`docs/06-database/SCHEMA.md` §4, already ported in Epic 0)

- `recommendations` — `opportunity_id`, `title`, `description`, `action_type (create_page|update_page|fix_technical|build_citations)`, `effort (low|medium|high)`, `impact (low|medium|high)`, `priority_rank`, `evidence_summary`, `implementation_notes`, `status`.

## What this epic actually builds

A recommendation is a **generated, human-readable, specific action** derived from an opportunity's evidence — not a rephrasing of the opportunity title. For a `unified` opportunity ("high demand + high GEO gap for 'managed X hosting'"), the recommendation is concretely: `action_type: create_page`, title "Build a comparison page: [Brand] vs [leading competitor] for managed X hosting", `evidence_summary` citing the exact keyword volume + competitor citation rate from `opportunity_evidence`, and `implementation_notes` covering both SEO requirements (from Epic 4's checklist) and GEO requirements (from `docs/11-geo/GEO_ENGINE.md`'s optimization principles — machine-readable, structured claims, FAQ format) in one brief. This dual-requirement briefing is the product's actual differentiation — a recommendation that only satisfies SEO or only satisfies GEO is an incomplete implementation of this epic.

`priority_rank` is computed from the parent opportunity's `opportunity_score` plus `effort` — cheap, high-impact recommendations rank above expensive, high-impact ones, matching `PRODUCT_VISION.md`'s "3 most valuable moves" framing (the product explicitly promises a short, prioritized list, not an undifferentiated backlog).

## Generation approach

Template-driven from `action_type`, populated with the opportunity's evidence — NOT a free-form LLM generation at this stage (that's Epic 11's Content Agent, generating the actual draft page). This epic produces the *brief*, deterministically, from structured opportunity data; Epic 11 consumes the brief to generate content. Keep this boundary exact: recommendation generation must not silently start writing page copy.

## API surface

- `POST /opportunities/:id/recommendations/generate` — idempotent (does not duplicate on re-run, same discipline as Epic 9).
- `GET /brands/:id/recommendations` — list, sorted by `priority_rank`.
- `PATCH /recommendations/:id` — status transitions, audit-logged.

## UI surface

Recommendations surface inline on the Opportunities screen (Epic 9) as the opportunity's "next action," and have their own filtered view for a "top 10 prioritized recommendations" experience matching `docs/09-ux/CUSTOMER_JOURNEY.md`'s onboarding Step 6 ("first 3 recommendations") and Stage 4 dashboard. Each recommendation must visibly carry its effort/impact and link to its source opportunity's evidence — never presented as a bare instruction with no backing.

## End-to-end flow (qa-flow-tester must trace every step below, not just the generation logic in isolation)

1. Generate a recommendation from a fixture `unified` opportunity — confirm the resulting `evidence_summary` actually quotes the specific numbers from that opportunity's `opportunity_evidence`, not a generic template string with no real data interpolated.
2. Confirm the recommendation's `implementation_notes` cover BOTH an SEO requirement (from Epic 4's checklist) and a GEO requirement (from the GEO optimization principles) — a recommendation missing either half is a spec violation, not a style choice.
3. Re-run generation for the same opportunity — confirm no duplicate `recommendations` row is created.
4. Confirm `priority_rank` ordering on `GET /brands/:id/recommendations` actually reflects opportunity_score + effort as documented, using at least two fixture recommendations with different effort/impact combinations.
5. A user changes a recommendation's status — confirm it's audit-logged and the Opportunities screen's inline "next action" updates to match.
6. Tenant isolation check across `recommendations`.

## Definition of done

Standard DoD. A test proving the dual SEO+GEO requirement is actually present in generated output for every `action_type`, not just `create_page`.
