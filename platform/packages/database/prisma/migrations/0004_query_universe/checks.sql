-- BeBest platform — CHECK constraints for Epic 5 (Intent & Query Universe)
--
-- Same rule as prisma/migrations/0000_init/checks.sql: only columns with a
-- genuinely closed, stable value set get a CHECK. `queries.priority`
-- (1=high/2=medium/3=low, a plain ranking int) deliberately does NOT get
-- one here — same precedent as `competitors.priority`
-- (packages/database/DECISIONS.md §15): validated by Zod at the API
-- boundary instead. `queries.category` is likewise left unconstrained even
-- though the epic spec documents exactly ten template categories, because
-- a human curating the query set (docs/epics/05-intent-query-universe.md's
-- "manual add" surface) must be able to tag a query with a category label
-- outside that fixed ten without the database rejecting the insert — the
-- ten are what the TEMPLATE GENERATOR emits, not a hard product-wide
-- taxonomy limit; see DECISIONS.md §6's "deliberately not constrained"
-- reasoning for the same tradeoff on other open-but-mostly-fixed columns.
--
-- Not applied automatically — same caveat as every other migration folder.

BEGIN;

-- query_sets.status — draft | active | archived (docs/06-database/SCHEMA.md
-- §3's literal DDL comment; also the exact three values
-- docs/epics/05-intent-query-universe.md's API surface names: generate
-- returns draft, activate flips to active, archive flips to archived).
ALTER TABLE query_sets ADD CONSTRAINT chk_query_sets_status
  CHECK (status IN ('draft', 'active', 'archived'));

-- queries.intent_type — informational | commercial | comparison |
-- transactional (docs/06-database/SCHEMA.md §3's literal DDL comment).
-- Nullable (a query can be added before its intent is classified), so the
-- CHECK allows NULL explicitly.
ALTER TABLE queries ADD CONSTRAINT chk_queries_intent_type
  CHECK (intent_type IS NULL OR intent_type IN ('informational', 'commercial', 'comparison', 'transactional'));

COMMIT;
