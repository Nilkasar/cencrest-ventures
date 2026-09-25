-- 0023 — `ai_runs` records the cost preflight that approved it.
--
-- THE GAP THIS CLOSES
--
-- A run's projected model spend is checked against the plan's dollar ceilings
-- BEFORE the row is created (`apps/api/src/lib/ai-usage/run-preflight.ts`),
-- but the worker re-reads the query set LIVE when it executes
-- (`apps/api/src/lib/ai-visibility/pipeline.ts` — `queries.findMany` by
-- `run.query_set_id`), which can be hours later after a queue backlog, a
-- worker restart, or a `releaseOnShutdown` retry. Nothing on the row said how
-- big the approved run was, so a set that grew between those two moments
-- executed against a price computed for a smaller one — and because the
-- projection was never persisted either, the overspend could not be detected
-- afterwards either.
--
-- `priced_query_count` is the approved SIZE, checked at execution
-- (`apps/api/src/lib/ai-usage/priced-run.ts`). `projected_cost_micro_usd` is
-- the approved FIGURE, in the same exact micro-dollar unit the valve compared
-- against the ceiling (BIGINT, not DECIMAL — no float, no re-rounding between
-- the check and the record), so "approved $12.40" can be set against the
-- org's real `ai_usage` rows for the same window. `cost_pricing_table_version`
-- names the `packages/ai-provider/src/pricing.ts` table that produced the
-- projection, so a historical approval stays explainable after prices move.
--
-- All three are NULLABLE, for rows created before this migration only. A NULL
-- `priced_query_count` means "never cost-approved" and is REFUSED at
-- execution (see `RunNotPricedError`) — it is never read as "unlimited".
-- Consequence at deploy time: any run already sitting in the pg-boss queue
-- when this ships will fail with that error and need re-dispatching. Drain
-- the AI-visibility queue first, or expect those runs to be retried.
--
-- RLS: none needed. `ai_runs` already carries the `tenant_isolation` policy
-- from `0008_ai_visibility_engine/rls.sql`, and a policy is table-scoped —
-- these three columns are covered by it the moment they exist. No new
-- tenant table and no new `organization_id` is introduced here.
--
-- Apply with the same runner as every other folder:
-- `pnpm --filter @bebest/database run db:apply`
-- (packages/database/scripts/apply-sql.mjs). `prisma migrate deploy` does
-- nothing in this repo — there is no migration.sql anywhere in it.

-- No explicit BEGIN/COMMIT here: `scripts/apply-sql.mjs` already runs each
-- file inside its own transaction together with its ledger row, and an inner
-- COMMIT would close that transaction early (same reason 0019's ddl.sql has
-- none).

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS priced_query_count INTEGER;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS projected_cost_micro_usd BIGINT;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS cost_pricing_table_version VARCHAR(20);
