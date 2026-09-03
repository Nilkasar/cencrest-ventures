-- Epic 15 (Reporting & Notifications).
--
-- Both `reports` and `notifications` are pre-existing, ported tables
-- (0000_init) whose `tenant_isolation` RLS policy already applies —
-- nothing to add there (see @bebest/database DECISIONS.md §29's "RLS /
-- CHECK" note). This migration widens `reports`/`notifications` with new
-- columns (schema.prisma) and adds the one CHECK constraint the widening
-- needs: `type` stays a plain VARCHAR (an already-"shipped" column can't
-- safely become a Prisma enum without a real data migration this package
-- never runs), so its closed vocabulary is enforced here instead, same
-- "CHECK on a genuinely closed VARCHAR taxonomy" discipline every other
-- migration's checks.sql already follows (0000_init/checks.sql's own
-- header, DECISIONS.md §6).
--
-- Not applied automatically — same caveat every other migration's
-- checks.sql carries: this package never connects to a real database.
-- Whoever runs the first real `prisma migrate deploy` applies this file
-- (and every prior migration's rls.sql/checks.sql) in order, per
-- DECISIONS.md §2/§6.

BEGIN;

-- reports.type: weekly | monthly | custom | baseline_comparison — this
-- epic's literal domain-model vocabulary
-- (docs/epics/15-reporting-notifications.md).
ALTER TABLE reports ADD CONSTRAINT chk_reports_type
  CHECK (type IN ('weekly', 'monthly', 'custom', 'baseline_comparison'));

COMMIT;
