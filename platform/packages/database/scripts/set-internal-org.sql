-- Marks BeBest's own operations organization as `organizations.kind =
-- 'internal'` (Epic 22, Workspace Views).
--
-- Why this is a script and not part of migration 0023: which org is the
-- internal one is deployment configuration — the API reads it from
-- `CRM_INTERNAL_ORG_ID` (apps/api/src/lib/internal-org.ts) — and a static
-- migration cannot know that id. The API deliberately does NOT infer
-- `internal` from the env var at request time: the column is the source of
-- truth for which view an org's members get, so it has to be right in the
-- data, not patched over in code.
--
-- Run once per environment, after `db:apply`, with the SAME id the API's
-- `CRM_INTERNAL_ORG_ID` is set to:
--
--   psql "$ADMIN_DATABASE_URL" -v org_id="'<CRM_INTERNAL_ORG_ID>'" \
--        -f packages/database/scripts/set-internal-org.sql
--
-- Idempotent. Fails loudly (and changes nothing) if the id names no live
-- organization, rather than silently updating zero rows. In development,
-- `pnpm --filter @bebest/api run seed:dev` already creates that org with
-- kind 'internal', so this is only needed for an org created another way.

BEGIN;

-- psql does not interpolate `:'org_id'` inside a dollar-quoted DO body, so
-- the id is handed in through a transaction-local setting instead.
SELECT set_config('bebest.internal_org_id', :'org_id', true);

DO $$
DECLARE
  target uuid := current_setting('bebest.internal_org_id')::uuid;
  updated integer;
BEGIN
  UPDATE organizations
     SET kind = 'internal', updated_at = now()
   WHERE id = target
     AND deleted_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'set-internal-org: no live organization with id %', target;
  END IF;
END
$$;

COMMIT;

-- Verify:
--   SELECT id, slug, kind FROM organizations WHERE kind = 'internal';
