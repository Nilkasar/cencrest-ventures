-- Epic 22 (Workspace Views), Phase 0 — Row-Level Security for the two new
-- staff-side tables. Neither is tenant data, so neither gets the usual
-- `tenant_isolation` policy; both are still put under RLS, deliberately.
--
-- WHY NOT LEAVE THEM WITHOUT RLS (like `users`/`organizations`)
--
-- The API serves every request as `bebest_app`. A table without RLS is fully
-- readable by that role, so ANY route — including a customer route with a
-- bug, or a future one written carelessly — could read who on BeBest's staff
-- looked at which customer, and when. That is not data any tenant should
-- ever be able to reach. RLS is the only control that holds regardless of
-- what route code does, so it is used here as a capability boundary rather
-- than a tenant boundary.
--
-- platform_access_events — APPEND-ONLY for the request-serving role.
--   One INSERT policy, and nothing else. With RLS FORCEd and no SELECT,
--   UPDATE or DELETE policy, `bebest_app` can write a row but can never
--   read, alter or remove one: a SELECT returns zero rows, an UPDATE or
--   DELETE matches zero rows. The tamper-evident property an access log
--   wants falls out of the policy set, the same way 0021 made
--   `audit_events` append-only.
--   The writer must therefore insert WITHOUT `RETURNING` (Postgres applies
--   SELECT policies to returned rows) — `middleware/platform-role.ts` uses
--   `createMany`, which issues a plain INSERT, for exactly that reason.
--   Reading the log is a Platform concern: `bebest_platform` has BYPASSRLS
--   (scripts/create-platform-role.sql) and is only reachable from
--   `apps/api/src/routes/platform/**`.
--
-- support_sessions — NO policy at all in Phase 0.
--   Nothing uses it yet. RLS FORCEd with no policy denies every operation
--   to `bebest_app`; Phase 4 adds exactly the access path it needs. Failing
--   closed until then is the point.

BEGIN;

ALTER TABLE platform_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_access_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_access_events_append ON platform_access_events
  FOR INSERT
  WITH CHECK (true);

ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions FORCE ROW LEVEL SECURITY;

COMMIT;
