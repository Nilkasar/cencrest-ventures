-- 0020 — every RLS policy becomes null-safe about its session setting.
--
-- THE BUG
--
-- Every policy in this schema was written as, in effect:
--
--     organization_id = current_setting('app.current_org', TRUE)::uuid
--
-- The `TRUE` ("missing_ok") was chosen so an unset variable yields NULL and
-- the comparison is never true — fail closed, exactly right. But
-- `current_setting(..., TRUE)` only returns NULL while the setting has
-- never been defined on that session. `set_config(..., true)` is
-- transaction-local: at COMMIT the value does not disappear, it reverts to
-- the empty string. From then on, for the life of that pooled connection,
-- the expression evaluates `''::uuid` — which is not NULL and not false,
-- it is `22P02 invalid input syntax for type uuid`.
--
-- So the policy raised an error instead of filtering. Concretely: any read
-- of `memberships` inside `withUserContext` (which sets `app.current_user`
-- but not `app.current_org`) threw as soon as that connection had
-- previously served ANY org-scoped request — which is to say, almost
-- immediately under real traffic. `tenant-context.ts` does exactly that on
-- every authenticated request, so the API returned 500 for everything.
--
-- WHY IT WAS NEVER SEEN
--
-- The development database connected as a role with BYPASSRLS. Policies
-- that are never evaluated cannot throw. The bug was therefore invisible
-- until the connection role was corrected — that is, it would have appeared
-- the moment someone deployed properly, and only then. See
-- packages/database/src/rls-check.ts, which now refuses to let that
-- combination pass unnoticed in either direction.
--
-- THE FIX
--
-- `NULLIF(current_setting(...), '')::uuid` — the empty string becomes NULL
-- before the cast, restoring the fail-closed behaviour the original comment
-- describes: no context set means no rows match, and nothing raises.
--
-- Applied to every existing policy generically rather than by re-listing
-- 107 tables, so no table can be missed and the column each policy already
-- keys on is preserved exactly.

BEGIN;

DO $$
DECLARE
  r RECORD;
  col TEXT;
BEGIN
  FOR r IN
    SELECT cl.relname AS tbl,
           p.polname  AS pol,
           pg_get_expr(p.polqual, p.polrelid) AS expr
      FROM pg_policy p
      JOIN pg_class cl ON cl.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE ns.nspname = 'public'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting%'
       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%NULLIF%'
  LOOP
    IF r.expr LIKE '%app.current_user%' THEN
      -- memberships: the OR of a user-scoped and an org-scoped clause. Both
      -- sides need the same treatment; the user side is the one that was
      -- actually throwing in production paths.
      EXECUTE format('DROP POLICY %I ON public.%I', r.pol, r.tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I'
        ' USING ('
        '   user_id = NULLIF(current_setting(''app.current_user'', TRUE), '''')::uuid'
        '   OR organization_id = NULLIF(current_setting(''app.current_org'', TRUE), '''')::uuid)'
        ' WITH CHECK ('
        '   user_id = NULLIF(current_setting(''app.current_user'', TRUE), '''')::uuid'
        '   OR organization_id = NULLIF(current_setting(''app.current_org'', TRUE), '''')::uuid)',
        r.pol, r.tbl);
    ELSE
      -- Every other policy keys on exactly one column. Read it back out of
      -- the existing expression rather than guessing, so a table that scopes
      -- by `agency_org_id` keeps scoping by `agency_org_id`.
      col := CASE
               WHEN r.expr LIKE '%agency_org_id%' THEN 'agency_org_id'
               WHEN r.expr LIKE '%organization_id%' THEN 'organization_id'
               ELSE NULL
             END;
      IF col IS NULL THEN
        RAISE EXCEPTION 'Policy %.% uses current_setting but no known scope column: %',
          r.tbl, r.pol, r.expr;
      END IF;

      EXECUTE format('DROP POLICY %I ON public.%I', r.pol, r.tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I'
        ' USING (%I = NULLIF(current_setting(''app.current_org'', TRUE), '''')::uuid)'
        ' WITH CHECK (%I = NULLIF(current_setting(''app.current_org'', TRUE), '''')::uuid)',
        r.pol, r.tbl, col, col);
    END IF;
  END LOOP;
END
$$;

-- Nothing may be left casting a raw setting to uuid.
DO $$
DECLARE leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policy p
    JOIN pg_class cl ON cl.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
   WHERE ns.nspname = 'public'
     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting%'
     AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%NULLIF%';

  IF leftover > 0 THEN
    RAISE EXCEPTION '% policies still cast a session setting without NULLIF', leftover;
  END IF;
END
$$;

COMMIT;
