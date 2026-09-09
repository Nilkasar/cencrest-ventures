-- Creates the role the API should serve requests as.
--
-- Why this matters more than it looks: every tenant table in this schema
-- has RLS enabled and FORCEd, and every scoped query goes through
-- `withOrgContext`. All of that is inert if the connecting role can bypass
-- RLS — and the failure is silent. The application works, the tests pass,
-- and every tenant sees every other tenant's rows.
--
-- Measured on this project's own development database: connected as the
-- provider's default owner role (which carries BYPASSRLS), a query
-- deliberately scoped to the WRONG organization returned every row in the
-- table. The policies were correct throughout. Nothing in the application
-- could tell — which is exactly why `packages/database/src/rls-check.ts`
-- now asks Postgres at boot.
--
-- Run this as the database owner, once, then point the API's DATABASE_URL
-- at `bebest_app`. Keep the owner role for migrations and seeding only.
--
--   psql "$ADMIN_DATABASE_URL" -v app_password="'a-real-password'" \
--        -f packages/database/scripts/create-app-role.sql
--
-- Managed providers differ on what they allow here (some do not grant
-- CREATE ROLE at all). Where it cannot be run, treat "the API connects as a
-- BYPASSRLS role" as an accepted, written-down risk rather than an
-- invisible one — the startup check will keep saying so.

BEGIN;

-- The request-serving role. No BYPASSRLS, no superuser, and it must never
-- own a table: both of those defeat RLS independently of the policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bebest_app') THEN
    EXECUTE format('CREATE ROLE bebest_app LOGIN PASSWORD %L', :'app_password');
  END IF;
END
$$;

ALTER ROLE bebest_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Enough to serve requests, and nothing more. No DDL: schema changes go
-- through the owner role and `db:apply`.
GRANT CONNECT ON DATABASE CURRENT_CATALOG TO bebest_app;
GRANT USAGE ON SCHEMA public TO bebest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bebest_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bebest_app;

-- Tables created by later migrations get the same grants automatically,
-- so a new epic's tables are not silently unreadable by the API.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bebest_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bebest_app;

COMMIT;

-- Verify — this must report bypassrls = false:
--   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'bebest_app';
--
-- And then, connected AS bebest_app, this must return 0:
--   BEGIN;
--   SELECT set_config('app.current_org', '00000000-0000-4000-8000-000000000000', true);
--   SELECT count(*) FROM leads;
--   ROLLBACK;
