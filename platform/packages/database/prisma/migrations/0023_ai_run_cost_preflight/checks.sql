-- 0023 — CHECK constraints for the persisted cost preflight on `ai_runs`.
--
-- Neither column has a closed value set (DECISIONS.md §6's rule for when a
-- CHECK is warranted), but both have a hard floor that a bug could otherwise
-- write straight past: a negative approved size or a negative approved cost
-- would silently disable the comparison in
-- `apps/api/src/lib/ai-usage/priced-run.ts` (every live count would look
-- "within budget"). Cheap to assert at the one place it cannot be bypassed.

-- No explicit BEGIN/COMMIT — see ddl.sql in this folder.

ALTER TABLE ai_runs ADD CONSTRAINT chk_ai_runs_priced_query_count_non_negative
  CHECK (priced_query_count IS NULL OR priced_query_count >= 0);

ALTER TABLE ai_runs ADD CONSTRAINT chk_ai_runs_projected_cost_non_negative
  CHECK (projected_cost_micro_usd IS NULL OR projected_cost_micro_usd >= 0);
