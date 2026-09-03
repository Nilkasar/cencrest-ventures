-- BeBest platform — CHECK constraints for Epic 18 (Agency / White Label /
-- Integrations).
--
-- `agency_clients.status`'s closed vocabulary widens from
-- {active, paused, terminated} (0000_init/checks.sql's
-- chk_agency_clients_status) to also include:
--   - `pending`  — the row exists (an agency invited a client) but the
--                  client org has not yet consented. This is the epic's
--                  explicit "not agencies silently claiming any org id"
--                  requirement given a real value to start at — see
--                  schema.prisma's `agency_clients` doc comment and
--                  `apps/api/src/routes/agency.ts`.
--   - `revoked`  — access explicitly pulled (by either side), distinct
--                  from `terminated`'s "contract ended" business meaning.
--                  This is the value the epic's DoD-mandated test
--                  ("revoking a link immediately blocks a subsequent
--                  request") sets and checks for.
--
-- Same "new migration folder supersedes an earlier one, never edited in
-- place" precedent 0006_epic5_postverification_fixes already established
-- for a different table's CHECK — see that folder's own header comment.
-- A DROP + re-ADD is used (not an ALTER ... ADD VALUE, which doesn't exist
-- for a plain CHECK) so the constraint name stays the same one downstream
-- tooling would look for.
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

ALTER TABLE agency_clients DROP CONSTRAINT IF EXISTS chk_agency_clients_status;
ALTER TABLE agency_clients ADD CONSTRAINT chk_agency_clients_status
  CHECK (status IN ('pending', 'active', 'paused', 'terminated', 'revoked'));

COMMIT;
