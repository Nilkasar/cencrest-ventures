# Epic 15 — Reporting & Notifications (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 7 (AI Visibility), Epic 4 (SEO), Epic 9 (Opportunities), Epic 14 (Measurement) — this epic packages their outputs into human-facing artifacts; it does not compute anything new.

## Why this epic

`docs/09-ux/CUSTOMER_JOURNEY.md`'s retention mechanic is explicit: "Weekly digest that proves value," "Regular new opportunities discovered," "Low effort to implement." Without packaged reporting, a customer would have to piece together their own status from six different screens — this epic is what makes the product feel like it's actively working for them.

## Report types (`docs/09-ux/CUSTOMER_JOURNEY.md`'s Reports screen, implement all four)

- **Weekly digest** (automated): what changed this week — score deltas (Epic 14), new opportunities (Epic 9), competitor movement (Epic 8).
- **Monthly performance report** (automated): broader trend view.
- **Custom report** (manual trigger): user picks a date range/scope.
- **Baseline comparison report** (quarterly): the full before/after story since the customer's original baseline.

Every report type pulls from already-computed, already-verified data (Epic 4/7/8/9/14) — this epic's own logic is templating/aggregation/scheduling, not scoring.

## Domain model

- `reports` — `type` (`weekly|monthly|custom|baseline_comparison`), `organization_id`, `brand_id`, `period_start`/`period_end`, `generated_at`, `content` (JSONB — the assembled report data, so a report is reproducible/viewable later even if underlying scores later change), `pdf_url` (nullable — PDF export is a nice-to-have, not blocking).
- `notifications` — `organization_id`, `user_id` (nullable — org-wide vs. per-user), `type` (`report_ready|weekly_digest|competitor_alert|entitlement_warning|...`), `channel` (`in_app|email`), `read_at`, `sent_at`.

## Notification delivery (`docs/13-agents/AGENT_ARCHITECTURE.md`'s "notify user (email + in-app)" pattern, reused everywhere)

Every prior epic that produces something worth telling a customer about (an agent run completing, a competitor's score moving, an entitlement limit approaching) should route through ONE shared `notify()` function here rather than each epic inventing its own email-sending logic — audit which epics currently have ad hoc notification stubs (Epic 12's agent completion, Epic 8's movement alerts) and consolidate them onto this epic's real mechanism, reusing Epic 0's `EmailSender` interface for the email channel.

## Non-negotiable: reports are immutable snapshots

Per the `content` JSONB design above — a report generated today must render identically if viewed next month, even if the underlying brand's live scores have changed since. Do not build reports as live queries re-run on every view.

## API surface

- `GET /brands/:id/reports` — list, filterable by type.
- `POST /brands/:id/reports/generate` (custom, manual trigger).
- `GET /reports/:id` — the immutable snapshot.
- `GET /notifications`, `POST /notifications/:id/read`.

## UI surface

Per `docs/09-ux/CUSTOMER_JOURNEY.md`'s "Reports" screen ("Can I show this to my team/board?") — reports need to look board-presentable, matching the premium design bar the whole product is held to, not a bare data dump. A notification center (bell icon pattern) for in-app notifications, consistent with the app shell already built in Epic 0.

## End-to-end flow (qa-flow-tester must trace every step below, not just report generation in isolation)

1. Simulate a week's worth of real events (a score change from Epic 14, a new opportunity from Epic 9, a competitor movement from Epic 8) → trigger weekly digest generation → confirm the resulting `reports.content` actually contains references to those specific real records, not placeholder text.
2. View a generated report, then mutate the underlying brand's live score, then re-view the SAME report → confirm it renders identically (the immutability guarantee) rather than reflecting the new live score.
3. Confirm a notification is created for at least one real trigger (e.g. agent run completion from Epic 12) via the shared `notify()` function, not a duplicate ad hoc path — grep other epics' code for any leftover direct email-sending that should have been consolidated here.
4. Mark a notification read → confirm `read_at` persists and the UI reflects it.
5. Tenant isolation check across `reports`/`notifications`.

## Definition of done

Standard DoD. A test proving report immutability explicitly (generate, mutate source data, re-fetch, assert unchanged).
