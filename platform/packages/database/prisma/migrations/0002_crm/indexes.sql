-- BeBest platform — Epic 1 (CRM) supplemental partial indexes
--
-- Same rationale as 0000_init/indexes.sql: Prisma's `@@index` cannot express
-- a partial (`WHERE`-qualified) index, so the hot, narrow query shapes the
-- Leads inbox and Deals pipeline screens actually run get one by hand.
--
-- Not applied automatically — see 0000_init/rls.sql's header for the same
-- caveat.

BEGIN;

-- Leads inbox default view: "who's new / not yet converted or lost", newest
-- first, for the internal org.
CREATE INDEX idx_leads_org_open ON leads(organization_id, created_at DESC)
  WHERE deleted_at IS NULL AND status NOT IN ('converted', 'lost');

-- Deals pipeline board: open deals grouped by stage, for the internal org.
CREATE INDEX idx_deals_org_stage_open ON deals(organization_id, stage)
  WHERE deleted_at IS NULL AND stage NOT IN ('won', 'lost');

-- "My open deals" — the owner-scoped pipeline view.
CREATE INDEX idx_deals_owner_open ON deals(owner_id, stage)
  WHERE deleted_at IS NULL AND stage NOT IN ('won', 'lost');

COMMIT;
