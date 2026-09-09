-- 0021 — `audit_events` gets separate read and append policies.
--
-- THE BUG
--
-- `audit_events` carried one `FOR ALL` policy keyed on `organization_id`,
-- so an INSERT had to satisfy it too. But `lib/audit.ts` writes through the
-- UN-scoped client (deliberately — an audit write must not depend on the
-- caller having established tenant context, and platform-level events like
-- `auth.login` have no organization at all). With no `app.current_org` set,
-- the WITH CHECK compared `organization_id` to NULL, which is never true,
-- and Postgres refused the row: `42501 new row violates row-level security
-- policy for table "audit_events"`.
--
-- `writeAuditEvent` swallows its own failures on purpose — an audit write
-- must never break the privileged action it records — so the result was
-- silence. Under a correctly-privileged role the audit trail simply stopped:
-- measured on this project's own database, zero rows were written from the
-- moment the API switched off the BYPASSRLS role, while logins, lead
-- conversions and deal stage changes carried on succeeding. A security log
-- that quietly records nothing is worse than not having one, because
-- everything looks fine.
--
-- (`lib/audit.ts`'s own header predicted this and deferred it to "once
-- integration tests exist against a real Postgres instance". They do now.)
--
-- THE FIX
--
-- Reads stay tenant-scoped: one organization must not see another's audit
-- history, and platform-level rows (organization_id IS NULL) belong to no
-- tenant, so they are invisible to all of them — correct.
--
-- Appends are allowed for a row that either names no organization or names
-- the one the caller is scoped to. Combined with `writeAuditEvent` now
-- running org-attributed writes inside `withOrgContext`, that means a
-- legitimate audit row is always writable and a row cannot be attributed to
-- an organization the writer is not acting as.
--
-- No UPDATE or DELETE policy is created. `audit_events` is append-only;
-- with RLS enabled and no policy for those commands, they are refused
-- outright — which is exactly what a tamper-evident log wants.

BEGIN;

DROP POLICY IF EXISTS tenant_isolation ON audit_events;

CREATE POLICY audit_events_read ON audit_events
  FOR SELECT
  USING (organization_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid);

CREATE POLICY audit_events_append ON audit_events
  FOR INSERT
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid
  );

COMMIT;
