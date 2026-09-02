# Epic 8 — Competitive Intelligence (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 7 (AI Visibility Engine) — this epic runs the identical pipeline against competitors instead of the brand.

## Why this epic

`docs/11-geo/GEO_ENGINE.md`: "For each competitor: run the same query universe, extract the same observations, compute the same scores." This is not a separate engine — it's Epic 7's pipeline pointed at `competitors` (Epic 2) instead of the brand, plus the comparison math. Keeping it a distinct epic (rather than folding into Epic 7) is about scope control: Epic 7 must work correctly for one brand before multiplying it across N competitors.

## What this epic adds on top of Epic 7

- Reuse `ai_runs`/`ai_responses`/`brand_observations` — a competitor run is an `ai_run` scoped to a `competitor_id` instead of the brand (add a nullable `competitor_id` column if the Epic 0 schema didn't already anticipate this — check first).
- **Competitive Gap** = `Competitor AVS - Your AVS` (per intent and in aggregate).
- **Share of AI Voice** = `Your mentions / (Your mentions + all competitor mentions) × 100`.
- Per-intent competitor breakdown: "For 'best freight visibility software,' CompetitorA appears in 84% of responses at position 1, you appear in 2%" — this exact sentence structure is the product's signature evidence format (`docs/11-geo/GEO_ENGINE.md`), the UI and any generated report copy should produce it verbatim-shaped, not a vaguer summary.
- Gap classification (`docs/11-geo/GEO_ENGINE.md`'s four types): Intent Gaps, Content Gaps, Entity Gaps, Source/Citation Gaps — each is a distinct, labeled finding, not a single generic "you're behind" signal. This classification is what Epic 9's Opportunity Engine consumes directly.
- Movement alerts: "CompetitorA just increased their AI visibility by 15 points" (`docs/09-ux/CUSTOMER_JOURNEY.md`'s retention mechanic) — requires comparing consecutive competitor runs over time, which is naturally a scheduled/background concern; build the comparison logic now, wire the actual schedule trigger in Epic 12 (Agents) when the Competitor Agent exists.

## API surface

- `POST /brands/:id/competitors/:competitorId/ai-runs` (or extend Epic 7's endpoint to accept an optional `competitorId`).
- `GET /brands/:id/competitive-gaps` — the four-type classified gap list.
- `GET /brands/:id/share-of-voice`.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "Competitors" screen ("How do I compare?"): competitor AVS list, share-of-voice, per-intent comparison table, movement alerts feed. Entitlement-aware: number of competitors with active AI-run tracking is capped by plan tier (same enforcement pattern as Epic 2's competitor-add limit — reuse the `entitlements` helper built there).

## End-to-end flow (qa-flow-tester must trace every step below, not just each formula in isolation)

1. Trigger a competitor AI-run for a competitor added in Epic 2 — confirm it reuses Epic 7's exact pipeline (same job mechanism, same extraction, same raw-response-preserved-before-extraction guarantee), not a parallel, drifted implementation.
2. Once both the brand's and the competitor's runs exist for the same query set, confirm `GET /brands/:id/competitive-gaps` produces per-intent sentences matching the spec's exact evidence format ("CompetitorA appears in X% at position 1, you appear in Y%") — not a vaguer aggregate.
3. Confirm Share of AI Voice is computed correctly at the boundaries: zero brand mentions, zero competitor mentions, and a single tracked competitor — each should produce a sane (not NaN/divide-by-zero) result.
4. Confirm each of the four gap types (Intent/Content/Entity/Source) is independently identifiable in the API response — a UI or report consumer must be able to tell which type a given gap is, not infer it.
5. The Competitors screen renders the comparison table and reflects the plan's competitor-tracking limit (reusing Epic 2's entitlement helper) — confirm exceeding the limit is blocked with the same error pattern established in Epic 2, not a new one-off check.
6. Tenant isolation check across competitor run data.

## Definition of done

Standard DoD. A test proving Share of AI Voice sums correctly across brand + all competitors (an easy formula to get subtly wrong at the boundaries — zero mentions, single competitor, etc.).
