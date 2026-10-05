-- Creates `bebest_platform`, the role behind `@bebest/database/platform`
-- (`platformDb`) — Epic 22's cross-tenant Platform view.
--
-- WHY THIS ROLE, AND ONLY THIS ROLE, MAY BYPASS RLS
--
-- Tenant isolation in this schema rests on one fact: the role that serves
-- requests (`bebest_app`, create-app-role.sql) cannot bypass Row-Level
-- Security, so every tenant table only ever shows the org named in
-- `app.current_org`. BeBest staff legitimately need the opposite — every
-- org, every user, every job — and there are two ways to give it to them:
--
--   1. Teach `bebest_app` a way around its own policies (a "platform"
--      session flag every policy also accepts). Then the bypass lives on the
--      same connection every customer request uses, and is one missing
--      check — in any route — away from a cross-tenant leak.
--   2. A separate role on a separate connection that bypasses RLS outright,
--      held only by code that has already proven the caller is staff.
--
-- This is (2). `BYPASSRLS` here is deliberate and confined: the API only
-- builds this connection when `PLATFORM_DATABASE_URL` is set, only
-- `apps/api/src/routes/platform/**` may import it (an ESLint
-- `no-restricted-imports` rule enforces that), and every one of those routes
-- sits behind `requirePlatformRole`, which re-reads `users.platform_role`
-- from the database and writes a `platform_access_events` row before the
-- handler runs. No other role the application uses may ever carry
-- BYPASSRLS — `rls-check.ts` refuses to boot production on a request role
-- that does.
--
-- GRANTS ARE READ-MOSTLY
--
-- Bypassing RLS is about which ROWS a role sees; privileges decide what it
-- may DO. Phase 0 grants SELECT on every table and INSERT on
-- `platform_access_events` only. Later phases add the specific writes they
-- need, one statement each, here:
--   Phase 1 — job retry/cancel (UPDATE on the job tables),
--             admin magic-link / disable user (INSERT magic_link_tokens,
--             UPDATE users).
--   Phase 4 — support_sessions (INSERT/UPDATE), plan comp / limit override,
--             org suspension, platform_role grants.
-- Never a blanket INSERT/UPDATE/DELETE: a staff tool that can read
-- everything should not also be able to change everything by default.
--
-- HOW TO RUN
--
-- As the database owner, once per environment:
--
--   psql "$ADMIN_DATABASE_URL" -v platform_password="'a-real-password'" \
--        -f packages/database/scripts/create-platform-role.sql
--
-- then set the API's `PLATFORM_DATABASE_URL` to a connection string for
-- `bebest_platform`. Creating a role with BYPASSRLS requires the running
-- role to have BYPASSRLS itself (or be a superuser); a managed provider's
-- owner role usually does. See GO_LIVE.md §1.2.

BEGIN;

-- psql does not interpolate `:'platform_password'` inside a dollar-quoted DO
-- body, so the password is handed in through a transaction-local setting.
SELECT set_config('bebest.platform_password', :'platform_password', true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bebest_platform') THEN
    EXECUTE format(
      'CREATE ROLE bebest_platform LOGIN PASSWORD %L',
      current_setting('bebest.platform_password')
    );
  END IF;
END
$$;

-- NOSUPERUSER is not in this list on purpose: Postgres lets only a superuser
-- change that attribute at all (even to turn it off), so on a managed
-- provider the statement would fail. A new role is never a superuser; the
-- check below refuses to continue if a pre-existing one somehow is.
ALTER ROLE bebest_platform BYPASSRLS NOCREATEDB NOCREATEROLE;

DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = 'bebest_platform') THEN
    RAISE EXCEPTION 'bebest_platform is a superuser — refusing; it must be an ordinary BYPASSRLS role';
  END IF;
END
$$;

-- `GRANT ... ON DATABASE` takes a name, not an expression
-- (`CURRENT_CATALOG` there is a syntax error), hence the dynamic statement.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bebest_platform', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO bebest_platform;

-- Read everything — that is what the Platform view is for.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bebest_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO bebest_platform;

-- Phase 0's only write: the access log itself.
GRANT INSERT ON platform_access_events TO bebest_platform;

COMMIT;

-- Verify — must report bypassrls = true, superuser = false:
--   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'bebest_platform';
--
-- And connected AS bebest_platform, this must succeed and the second must fail:
--   SELECT count(*) FROM organizations;
--   DELETE FROM leads WHERE false;   -- ERROR: permission denied for table leads
