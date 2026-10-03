-- 0023 — Epic 22 (Workspace Views), Phase 0: the domain model behind the
-- Platform / Organization / Agency views (platform/docs/epics/22-workspace-views.md).
--
--   users.platform_role         none | support | admin — BeBest staff access
--   organizations.kind          customer | agency | internal
--   platform_access_events      append-only audit of every Platform API call
--   support_sessions            read-only "view as org" sessions (used in Phase 4)
--
-- WHY EVERY STATEMENT HERE IS "IF NOT EXISTS"
--
-- `db:apply` (scripts/apply-sql.mjs) builds a FRESH database by rendering
-- `schema.prisma` to DDL first and then running every folder. On a fresh
-- database these columns, tables and foreign keys therefore already exist by
-- the time this file runs, and it must be a no-op. On an EXISTING database
-- the rendered schema step was applied long ago and is not re-run, so this
-- file is the only thing that adds them. Same names as Prisma generates
-- (`<table>_pkey`, `<table>_<column>_fkey`), so both paths converge on an
-- identical schema. Indexes, CHECKs and RLS live in this folder's
-- indexes.sql / checks.sql / rls.sql, as in every other folder.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_role VARCHAR(20) NOT NULL DEFAULT 'none';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'customer';

CREATE TABLE IF NOT EXISTS platform_access_events (
  id             UUID         NOT NULL DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL,
  platform_role  VARCHAR(20)  NOT NULL,
  action         VARCHAR(100) NOT NULL,
  target_org_id  UUID,
  target_user_id UUID,
  request_path   TEXT         NOT NULL,
  method         VARCHAR(10)  NOT NULL,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT platform_access_events_pkey PRIMARY KEY (id),
  CONSTRAINT platform_access_events_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT platform_access_events_target_org_id_fkey FOREIGN KEY (target_org_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT platform_access_events_target_user_id_fkey FOREIGN KEY (target_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS support_sessions (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL,
  org_id        UUID NOT NULL,
  reason        TEXT NOT NULL,
  started_at    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TIMESTAMPTZ(6),
  expires_at    TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT support_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT support_sessions_staff_user_id_fkey FOREIGN KEY (staff_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT support_sessions_org_id_fkey FOREIGN KEY (org_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- Backfill: which existing orgs are agencies.
--
-- An org is an agency if it has ever acted as one — it is the agency side of
-- any `agency_clients` row, whatever that row's status (a revoked or
-- terminated link still means the org works as an agency) — or if its
-- subscription's plan grants a positive `client_accounts` limit.
--
-- "Positive" deliberately means an explicit number greater than zero, not
-- merely non-zero: in `plans.limits` a JSON `null` means UNLIMITED
-- (`lib/entitlements.ts`'s `checkUsageLimit`: `if (limit === null) return`),
-- and the catalog (`apps/api/src/lib/billing/plan-catalog.ts`) carries
-- `client_accounts: null` on every tier that has no agency concept at all
-- (free/starter/growth/pro/managed/enterprise). Treating null as "grants
-- client accounts" would make every org an agency. Only the `agency` tier
-- carries a real number (20) today.
--
-- `jsonb_typeof(...) = 'number'` guards the cast, so a malformed value can
-- never fail the migration. The `kind = 'customer'` guard keeps this
-- re-runnable and never downgrades an org already marked `internal`.
--
-- The internal ops org (`CRM_INTERNAL_ORG_ID`) is deployment config that
-- static SQL cannot know — see scripts/set-internal-org.sql.
--
-- Runs as the migration role (db:apply's owner connection), which is not
-- subject to `agency_clients`' RLS policy; under any other role the
-- subquery would see no rows and simply backfill nothing.
UPDATE organizations o
   SET kind = 'agency'
 WHERE o.kind = 'customer'
   AND (
     EXISTS (SELECT 1 FROM agency_clients ac WHERE ac.agency_org_id = o.id)
     OR EXISTS (
       SELECT 1
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.organization_id = o.id
          AND jsonb_typeof(p.limits -> 'client_accounts') = 'number'
          AND (p.limits ->> 'client_accounts')::numeric > 0
     )
   );

COMMIT;
