# Epic 11 — Content Intelligence & Generation (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 6 (AI Provider Abstraction) and Epic 10 (Recommendation Engine — a content-type recommendation is the trigger).

## Why this epic

`PRODUCT_VISION.md` Layer 5 (Generation) and ADR-007 (human approval required by default) meet here. This is the first epic where the system writes customer-facing content — the approval gate built here is the pattern every future generation/execution epic (Epic 12's agents, Epic 13's publishing) reuses.

## Domain model (`docs/06-database/SCHEMA.md` §Content, already ported in Epic 0)

- `content_briefs` — research-backed spec for a piece of content, generated FROM a `recommendation` (Epic 10) — carries the dual SEO+GEO requirements forward.
- `content_drafts` — generated content versions (plural — regenerating creates a new version, never overwrites).
- `content_approvals` — the approval workflow record (who approved, when, at what draft version).
- `published_content` — link to the actually-published page (real publishing is Epic 13; this epic stops at "approved draft ready to publish").

## The generation pipeline (`docs/13-agents/AGENT_ARCHITECTURE.md`'s Content Agent, scoped to non-agent-runner generation for this epic — the full autonomous Agent wrapper is Epic 12)

```
1. Receive content brief (from an approved, content-type Recommendation)
2. Research evidence and claims (pull from brand_claims [Epic 2], opportunity_evidence [Epic 9])
3. Generate outline, then full draft (via AIProvider — task 'content.generation', per Epic 6's routing table)
4. Run quality checks: fact-check against brand_claims, brand-voice consistency, duplicate-content check against Epic 3's crawled pages, SEO checklist (Epic 4), GEO structuring principles (docs/11-geo/GEO_ENGINE.md: FAQ format, numbered lists, citable statements)
5. Present for human approval — ALWAYS, regardless of autonomy level, for this epic (Level 3+ auto-execute is Epic 13's concern, not this one)
```

Every quality check's result is stored alongside the draft (not just a pass/fail gate that discards its own reasoning) — a reviewer approving a draft needs to see what was checked, not just that something was.

## Non-negotiable: ADR-007 applies literally

No draft this epic produces is ever published automatically. `content_approvals` requires an explicit human action (`owner`/`admin`/`editor`-on-own-draft per the RBAC matrix) before a draft can move to `published_content`. This epic builds up to and including "approved," never past it.

## API surface

- `POST /recommendations/:id/content-brief` — generate a brief from an approved content-type recommendation.
- `POST /content-briefs/:id/draft` — generate a draft (creates a new `content_drafts` version each call, never overwrites).
- `GET /content-drafts/:id/quality-checks` — the stored check results.
- `POST /content-drafts/:id/approve` — writes `content_approvals`, audit-logged (publishing/content-approval is explicitly on SECURITY.md's always-audit list once Epic 13 wires actual publishing, but the approval action itself should be logged now).

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "Content" screen: active briefs, drafts awaiting approval (with the quality-check results visible, not hidden behind a click), published content. The approval screen must show the draft alongside its brief's original requirements — a reviewer approving blind, without the brief in view, defeats the point of the approval gate.

## End-to-end flow (qa-flow-tester must trace every step below, not just the generation call in isolation)

1. Approve a content-type recommendation (Epic 10) → generate its brief → confirm the brief actually carries forward the recommendation's dual SEO+GEO `implementation_notes`, not a stripped-down summary.
2. Generate a draft from the brief (mocked AIProvider) → confirm it goes through `taskDefaults['content.generation']` per Epic 6's routing, and that the raw generation call is versioned (`promptVersion` stored) like every other AI call in this system.
3. Generate a SECOND draft from the same brief → confirm this creates version 2, and version 1 remains readable (never overwritten or deleted).
4. Confirm every quality check (fact, brand-voice, duplicate, SEO, GEO) actually ran and its individual result is stored and visible in the UI — not a single aggregate "passed" flag.
5. A reviewer without `owner`/`admin`/`editor`-on-own-draft role attempts to approve — confirm it's rejected server-side.
6. A reviewer approves the draft → confirm `content_approvals` is written, audit-logged, and NOTHING is published as a side effect (Epic 13 territory) — the draft's status should reflect "approved, ready to publish," not "published."
7. Tenant isolation check across `content_briefs`, `content_drafts`, `content_approvals`.

## Definition of done

Standard DoD. A test proving draft generation never bypasses the quality-check step, and that approval never triggers publishing in this epic's code (that boundary must be enforced by absence of any publish call, not by convention).
