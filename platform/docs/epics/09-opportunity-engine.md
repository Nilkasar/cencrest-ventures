# Epic 9 — Opportunity Engine (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 4 (SEO opportunities) and Epic 8 (GEO gaps) both producing data.

## Why this epic

This is `PRODUCT_VISION.md`'s "Pillar 3: Unified Opportunity Engine" — the entire pitch is finding intersections ("high search demand + low AI visibility = highest-ROI intervention point"), not just listing SEO gaps and GEO gaps separately. This epic is the merge point.

## Domain model (`docs/06-database/SCHEMA.md` §4, already ported/audited in Epic 0)

- `opportunities` — `type (seo|geo|unified|content|technical)`, `intent`, `seo_demand_score`, `geo_gap_score`, `effort_score`, `impact_score`, `opportunity_score`, `scoring_formula_version`, `status`, `priority`.
- `opportunity_evidence` — links back to the specific `ai_responses`/`keywords`/competitor-observation rows that justify the opportunity (`source_table`, `source_id`, `summary`, `raw_data`). This table is what makes `PRODUCT_VISION.md`'s evidence example real: "1,200 monthly searches... competitor appears 84%... your brand 2%... no page on this topic" — each clause in that sentence is one `opportunity_evidence` row.

## The merge logic (this epic's actual job)

For each `intent` in the brand's Query Universe (Epic 5) that also has keyword demand data (Epic 4):
1. Pull the SEO opportunity score for that intent (Epic 4).
2. Pull the GEO gap classification for that intent (Epic 8).
3. An intent with HIGH SEO demand AND a HIGH GEO gap (competitor dominates AI answers, brand doesn't) is a **unified opportunity** — score it higher than either signal alone would. An intent with only one signal present is still a valid `seo` or `geo`-typed opportunity, just not "unified."
4. Write one `opportunities` row per intent with type set accordingly, plus `opportunity_evidence` rows citing the specific keyword/AI-response data that justified it.

This is where "effort/impact ranking" (`PRODUCT_VISION.md` Layer 3) becomes real — `effort_score` should already exist per-opportunity from Epic 4's formula for SEO-sourced ones; for GEO-sourced or unified ones, define effort as a function of content-creation complexity (new page vs. citation-building vs. technical fix), documented and versioned like every other formula here.

## API surface

- `POST /brands/:id/opportunities/recompute` — runs the merge logic (idempotent — re-running should update existing open opportunities' scores, not duplicate them).
- `GET /brands/:id/opportunities` — list, sortable by `opportunity_score`, filterable by type/status/priority.
- `GET /opportunities/:id` — full detail including its evidence trail.
- `PATCH /opportunities/:id` — status transitions (open → in progress → complete/dismissed), audit-logged (this is exactly the kind of "moved a $65k-relevant decision" action `docs/08-security/SECURITY.md` expects logged).

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "Opportunities" screen ("What should I do next?") — the single most important screen in the product per that doc's own framing. Filterable by effort/impact/type, each opportunity's card must show its evidence inline or one click away, never buried. This screen is also explicitly named as the thing that should never just display data for its own sake — every opportunity needs a visible next action (create content brief → Epic 10/11, or dismiss with a reason).

## End-to-end flow (qa-flow-tester must trace every step below, not just each score in isolation)

1. Seed fixture data: one intent with both a high-demand keyword (Epic 4) and a high GEO gap (Epic 8) for the same brand — run `POST /brands/:id/opportunities/recompute` — confirm exactly one `opportunities` row is created, typed `unified`, with a higher `opportunity_score` than either signal would produce alone.
2. Confirm `opportunity_evidence` rows exist linking back to the *specific* keyword and AI-response/observation rows that justified it — open the opportunity in the UI and confirm a user can see that evidence inline or one click away, not just a bare score.
3. Re-run `recompute` with no new data — confirm the existing opportunity's score is updated in place, NOT duplicated (idempotency check, explicitly).
4. Change the underlying data (e.g. brand's coverage improves) and re-run — confirm the score changes accordingly and the evidence updates to match, not stale evidence attached to a new score.
5. A user changes an opportunity's status via `PATCH /opportunities/:id` (e.g. dismiss with a reason) — confirm it's audit-logged and the Opportunities screen reflects the new status immediately, and confirm a dismissed opportunity doesn't reappear on the next `recompute` unless the underlying signal materially changes (define and document this behavior explicitly if the spec doesn't already dictate it).
6. Tenant isolation check across `opportunities` and `opportunity_evidence`.

## Definition of done

Standard DoD. A test proving the merge logic correctly identifies a "unified" opportunity from fixture SEO+GEO data and does NOT duplicate rows on re-run (idempotency is easy to get wrong here and expensive to leave wrong — this table drives real prioritization decisions).
