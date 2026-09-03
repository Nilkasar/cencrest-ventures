# Epic 14 — Measurement & Learning Loop (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 13 (Actions — something must have executed to measure), Epic 7 (AI Visibility, for re-measurement).

## Why this epic

This is `PRODUCT_VISION.md`'s final loop stages (RE-MEASURE → LEARN → IMPROVE) and the Measurement Agent from `docs/13-agents/AGENT_ARCHITECTURE.md`. Without this epic, the product's central promise — "did the move improve the score?" — is unanswerable. It's also the only epic that closes the loop back to the beginning (`REPEAT`).

## The measurement flow (`docs/13-agents/AGENT_ARCHITECTURE.md`'s Measurement Agent, implement exactly)

1. Triggered automatically 4 weeks after an `actions` row's `executed_at` (a scheduled check — reuse whatever job mechanism exists, `setImmediate`-based placeholder acceptable with the same honest `// TODO: durable queue` marker every prior epic used).
2. Re-run the AI visibility baseline (Epic 7's pipeline, same query set) and/or SEO analysis (Epic 4) for the affected brand.
3. Compare before/after scores — before = the score at the time the action was approved (must be snapshotted then, not recomputed after the fact from possibly-changed data), after = the new re-run's score.
4. Produce an attribution estimate: did THIS action plausibly cause the change, or did something else move (a competitor's own change, a query-universe update)? `docs/13-agents/AGENT_ARCHITECTURE.md` calls this "attribution estimate," not certainty — the UI/report language must reflect that honestly (estimate, not proof).
5. Update the "learning model" — for this build's scope, this means recording the outcome (`opportunity_type` × `action_type` × observed score delta) in a queryable table, NOT a real ML model — document this explicitly as the honest scope boundary (a real pattern-recognition/formula-refinement system per `PRODUCT_VISION.md` Layer 8 is future work; this epic builds the data collection that a future system would train on).

## Domain model

- `measurements` — `action_id`, `brand_id`, `before_score` (JSONB snapshot, not a live reference — scores can change independently), `after_score`, `score_delta`, `attribution_confidence` (`high|medium|low`), `attribution_notes`, `measured_at`.
- `outcome_records` — `opportunity_type`, `action_type`, `score_delta`, `organization_id` (for future cross-customer pattern learning — Epic 8's competitor-visibility-changes and this table are the two feeds a real learning system would eventually consume).

## Non-negotiable: snapshot before-scores at approval time, not measurement time

If "before" is recomputed at measurement time from current data, a score that already changed for unrelated reasons corrupts the comparison. `actions` (Epic 13) or `measurements` must store the score AT THE MOMENT OF APPROVAL as an immutable snapshot.

## API surface

- `GET /brands/:id/measurements` — before/after comparisons, sorted by date.
- `GET /actions/:id/measurement` — single action's outcome once measured.
- (Internal/scheduled) the re-measurement trigger itself — not user-facing, but must be observable (log/event) per the transparency principle every agent epic follows.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s retention mechanic: "Weekly digest that proves value" and the Actions screen's "completed (with outcome)" section — surface the before/after delta directly on the action it measures, with the attribution confidence visibly labeled (never presented as more certain than it is).

## End-to-end flow (qa-flow-tester must trace every step below, not just the scoring diff in isolation)

1. An action executes (Epic 13) — confirm a before-score snapshot is captured AT APPROVAL TIME (trace the actual write, confirm it happens in Epic 13's approve path, not invented retroactively here).
2. Simulate the 4-week trigger firing (don't wait for real time — inject a controllable clock/trigger for testing) → confirm a new AI-visibility run is kicked off via Epic 7's real pipeline, not a reimplementation.
3. Confirm the delta calculation is a pure, testable function of (before_score, after_score) with deterministic, unit-tested output.
4. Confirm attribution language in both the API response and any UI copy uses "estimate"/confidence language, never asserts certainty the system doesn't have.
5. Confirm an `outcome_records` row is written alongside the `measurements` row, with the correct `opportunity_type`/`action_type` pulled from the real chain back to the original opportunity/recommendation (Epic 9/10), not guessed.
6. Tenant isolation check across `measurements`/`outcome_records`.

## Definition of done

Standard DoD. A test proving the before-score snapshot is genuinely immutable (mutating the live brand's current score after approval must not change what a later measurement compares against).
