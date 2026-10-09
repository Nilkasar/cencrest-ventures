-- 0024 — CHECK constraint for the new `billing_webhook_events.skipped_reason`.
--
-- A genuinely closed vocabulary (DECISIONS.md §6's bar for adding a CHECK):
-- there are exactly two reasons a well-signed, supported event is acknowledged
-- without being applied, and both are branches in
-- `apps/api/src/routes/billing-webhooks.ts`. NULL is the normal case — the
-- event was applied.
--
--   no_matching_subscription  — no `subscriptions` row carries the event's
--                               external customer id (a test event, or one
--                               that overtook its own `createCustomer`).
--   superseded_by_newer_event — the event is strictly older than the newest
--                               event already applied to that subscription.
--
-- Deliberately NOT covering `unsupported_event_type`: that case writes no row
-- at all (nothing was applied, so there is no effect to dedupe against later),
-- which the route's 200-ack path documents.

ALTER TABLE billing_webhook_events ADD CONSTRAINT chk_billing_webhook_events_skipped_reason
  CHECK (skipped_reason IS NULL OR skipped_reason IN ('no_matching_subscription', 'superseded_by_newer_event'));
