# Epic 5 — Intent & Query Universe (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect. Depends on Epic 2 (brand profile supplies seed categories/use-cases/competitors that queries are generated from).

## Why this epic, and why before the AI engines

The Query Universe (`docs/11-geo/GEO_ENGINE.md`) is the foundation both growth engines share — SEO's Intent Graph and GEO's buying-question set are the same underlying concept (a structured list of what buyers ask), generated once and consumed by both. Building it as its own epic, before Epic 6 (AI Provider Abstraction) and Epic 7 (AI Visibility Engine), means those epics consume an already-populated, already-tested query set instead of building query generation as a side effect of the AI runner.

## Domain model (`docs/06-database/SCHEMA.md` §3, already ported in Epic 0)

- `query_sets` — named collection per brand: `name, description, query_count, version, status (draft|active|archived)`.
- `queries` — `query_set_id, text, intent_type (informational|commercial|comparison|transactional), category, tags[], priority (1=high/2=medium/3=low)`.

## Query categories (`docs/11-geo/GEO_ENGINE.md`) — the generation logic this epic must implement

Category / Problem / Commercial / Comparison / Feature / Industry / Size / Geography / Intent(job-to-be-done) / Authority queries — ten categories, each templated from the brand profile (Epic 2's `categories`, `use_cases`, `competitors`).

Generation is a **template-based** first pass (no LLM required): given brand category "freight visibility software" and competitor "Acme TMS", produce `"best {category} for {use_case.industry}"`, `"{brand} vs {competitor}"`, `"what is {category}"`, etc. from the ten templates. This makes the query universe buildable and testable before Epic 6's AI abstraction exists at all — LLM-assisted elaboration (variant generation) is a clearly-marked enhancement layered on top later, not a blocking dependency now.

## Query Universe size by tier (`docs/11-geo/GEO_ENGINE.md` — entitlement-gated, same pattern as Epic 2's competitor limit)

Free: 20–50 sample. Starter: 200. Growth: 500. Pro: 1,400+. Enterprise: custom (5,000+). Enforce via the same entitlement mechanism as Epic 2 — cap generated query count at the plan's limit, don't silently generate more and hide them.

## API surface

- `POST /brands/:id/query-sets/generate` — runs the template-based generator against the brand profile, entitlement-capped, returns a `draft` query_set for review.
- `query_sets`: list/get, activate (draft → active, freezing `version`), archive.
- `queries`: list (filterable by intent_type/category), manual add/edit/remove (human curation, called out as available on paid tiers in `docs/11-geo/GEO_ENGINE.md`).

## UI surface

A review-and-curate screen, not just a generate button: show the generated queries grouped by the ten categories (mirrors the Intent Graph visualization in `docs/10-seo/SEO_ENGINE.md`'s example), let the user remove irrelevant ones and add missing ones before activating. This is the "Query universe" the customer effectively co-owns — treat it as an editable asset, not a black box.

## End-to-end flow (qa-flow-tester must trace every step below, not just the generator in isolation)

1. `POST /brands/:id/query-sets/generate` against a fixture brand profile (categories, use_cases, competitors from Epic 2) — confirm the returned `query_sets` row is `draft` status and the generated `queries` actually span multiple of the ten documented categories, not just one or two templates applied repeatedly.
2. Confirm the generated count is capped at the plan's tier limit BEFORE generation completes wastefully over the cap (don't generate 1,400 and truncate — check the cap going in).
3. A user edits the draft in the review UI (removes one query, adds a manual one) — confirm both changes persist and are reflected in `query_count` on the `query_sets` row.
4. User activates the query set — confirm `status` flips to `active` and `version` is frozen (a subsequent edit, if allowed at all, must not silently mutate the same version other epics may already be referencing).
5. Confirm Epic 6/7 can consume an `active` query_set's `queries` with no additional transformation — this is the literal handoff point to the next epic; verify the shape matches what Epic 7's spec expects.
6. Tenant isolation check across `query_sets`, `queries`.

## Definition of done

Standard DoD. Unit tests for the template generator (given a fixed brand profile fixture, assert the exact expected query set — deterministic, no AI involved, easy to test without a live DB or provider). Entitlement test for the tier-based cap.
