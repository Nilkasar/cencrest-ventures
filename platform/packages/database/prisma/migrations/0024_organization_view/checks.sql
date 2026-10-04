-- Epic 22 (Workspace Views), Phase 2 — CHECK constraints.

BEGIN;

-- organizations.autonomy_level_max: 1..3. Level 4 ("autonomous within
-- guardrails") is not representable at all — a second, database-level
-- layer under the hard block in apps/api/src/lib/agents/autonomy.ts.
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_autonomy_level_max
  CHECK (autonomy_level_max BETWEEN 1 AND 3);

COMMIT;
