-- 0019 — `audit_events.entity_id` becomes nullable.
--
-- Why: not every audited action has an entity id. `auth.login`,
-- `auth.logout` and `billing.webhook_received` are about a session or a
-- payload, not a row. With the column NOT NULL, the audit middleware filled
-- the gap with the literal string 'unknown', which Postgres rejects for a
-- UUID (`22P02 invalid input syntax for type uuid: "unknown"`). Because
-- `writeAuditEvent` deliberately never throws — an audit write must not
-- break the action it records — the failure was silent: those events
-- completed normally and wrote NO audit row at all.
--
-- This is the first migration folder holding plain DDL rather than only
-- CHECK/RLS/index statements. Apply it with the same runner as every other
-- folder: `pnpm --filter @bebest/database run db:apply` (see
-- packages/database/scripts/apply-sql.mjs), which applies the schema and
-- then every folder's SQL in order.

ALTER TABLE audit_events ALTER COLUMN entity_id DROP NOT NULL;
