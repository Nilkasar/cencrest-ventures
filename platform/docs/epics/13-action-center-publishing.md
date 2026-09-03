# Epic 13 — Action Center & Controlled Publishing (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 10 (Recommendation Engine), Epic 11 (Content Intelligence & Generation), Epic 12 (Agents — for Level 3 approvals).

## Why this epic

ADR-007 is the single most important trust decision in this product: "All content publishing requires explicit human approval by default." This epic is where that decision becomes enforced code, not policy. It's also where the product's "system generates, humans approve, system executes" loop (`PRODUCT_VISION.md` Pillar 5) closes for the first time — every prior epic stopped short of actually changing anything external.

## Domain model (`docs/06-database/SCHEMA.md` §4, already ported in Epic 0)

- `actions` — `recommendation_id`, `title`, `action_type`, `autonomy_level` (1-4, with 4 hard-blocked per Epic 12), `status`, `approved_by`, `approved_at`, `executed_at`, `rolled_back_at`, `result` (JSONB).

## The approval → execute → rollback lifecycle (implement exactly)

1. An approved `content_drafts` row (Epic 11) or a Level-3-approved agent action (Epic 12) becomes an `actions` row, `status: pending`.
2. Human approval (`owner`/`admin` only, per `docs/08-security/SECURITY.md`'s "Publish content: owner/admin only") → `POST /actions/:id/approve`, audit-logged.
3. Execution — for this epic's scope, "publish" means writing to `published_content` (a real, internal record of what was published and where) — actually pushing to a customer's external CMS is explicitly out of scope for this build (no real external CMS integration exists yet; document this as the honest boundary, matching every other epic's NullXProvider pattern — a `PublishTarget` interface with an internal-record-only default implementation).
4. **30-day rollback window is mandatory** (`docs/13-agents/AGENT_ARCHITECTURE.md`): `POST /actions/:id/rollback` reverts `published_content`'s status and is itself audit-logged. Enforce the 30-day window as a real, tested check, not just documented.
5. Every action, whether human-approved-and-executed (Level 1-3) or the explicitly-blocked Level 4, is audit-logged per `docs/08-security/SECURITY.md`'s "Autonomous agent actions" always-audit rule.

## Non-negotiable

No code path exists that publishes without a prior `approved_at` timestamp set by a real user action — this should be enforceable by reading the execute function's guard clause, not by convention. Autonomy Level 4 remains hard-blocked here too (Epic 12 blocks triggering it; this epic additionally makes sure even a manually-inserted `autonomy_level: 4` action can't execute without human approval, defense in depth).

## API surface

- `GET /brands/:id/actions` — pending approvals, in-progress, completed, rolled-back (matches `docs/09-ux/CUSTOMER_JOURNEY.md`'s Action Center screen sections exactly).
- `POST /actions/:id/approve`, `POST /actions/:id/execute` (separate from approve — a human might approve now and the system executes async), `POST /actions/:id/rollback`.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "Actions" screen ("What have I done and what happened?"): pending approvals (with the underlying recommendation/draft visible inline, not just a title), in-progress, completed (with outcome), rolled-back. This is the natural home for turning Epic 9/10/11's outputs into a completed action — link forward/backward between screens rather than treating Actions as an isolated list.

## End-to-end flow (qa-flow-tester must trace every step below, not just each status transition in isolation)

1. An approved content draft (Epic 11) becomes a pending `actions` row — confirm this handoff is real (a foreign key/reference to the actual `content_drafts` row), not a re-typed copy that could drift.
2. `owner` approves → confirm audit log entry, confirm `approved_by`/`approved_at` are set from the real authenticated user, not client-supplied.
3. Execute → confirm `published_content` row is created ONLY after approval (write a test that attempts execute without approval and confirms rejection), and that the internal `PublishTarget` default doesn't silently pretend to reach a real external CMS.
4. Rollback within 30 days → confirm it succeeds and is audit-logged; rollback attempted after 30 days → confirm it's rejected with a specific error, not silently allowed.
5. Attempt to execute a Level 4 action even with a manually-crafted request → confirm it's rejected regardless of any approval state (defense in depth against Epic 12's own block).
6. Tenant isolation check across `actions`/`published_content`.

## Definition of done

Standard DoD. A test proving the "no execute without approved_at" invariant holds even against a maliciously-crafted direct API call, not just the normal UI flow.
