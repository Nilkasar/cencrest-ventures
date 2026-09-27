-- 0024 — billing webhooks: ordering, and a record of what was NOT applied.
--
-- TWO DEFECTS, ONE PAIR OF TABLES
--
-- 1. NO ORDERING GUARD. `routes/billing-webhooks.ts` passed `occurredAt` into
--    the state machine but never compared it to anything, so events were
--    applied in ARRIVAL order. Stripe does not guarantee delivery order (and
--    retries make it worse: a webhook that failed at 10:00 can be redelivered
--    after the 10:05 event has already landed). An older
--    `invoice.payment_failed` arriving after a newer
--    `invoice.payment_succeeded` therefore downgraded a subscription that had
--    already recovered — silently, and with no record that it happened.
--
--    `subscriptions.last_billing_event_at` is the `occurredAt` of the newest
--    event already applied to the row. Anything strictly older is refused.
--    Same-second events (Stripe's `event.created` has one-second resolution)
--    still apply in arrival order — the guard rejects going BACKWARDS, it does
--    not invent an ordering Stripe never gave us.
--    `last_billing_event_id` records WHICH event last moved the row.
--
-- 2. NO RECORD OF A DELIBERATE SKIP. `processed_at` was set both for an event
--    that was applied and for one that was acknowledged and ignored (no
--    matching subscription), so the two were indistinguishable afterwards.
--    With ordering added there is now a third case, and it is exactly the one
--    a human would need to audit. `skipped_reason` names it;
--    `occurred_at` persists the timestamp the decision was made against.
--
-- RLS: none needed, and none possible in one case.
--   * `subscriptions` already carries `tenant_isolation` from
--     `0000_init/rls.sql`; a policy is table-scoped, so these two columns are
--     covered the moment they exist.
--   * `billing_webhook_events` has RLS DELIBERATELY DISABLED (see
--     `0009_billing/rls.sql`): a webhook arrives knowing only an external
--     customer id, so there is no tenant context to set before the lookup that
--     would establish one — the same documented exemption as `invitations`.
--     These two columns add no tenant data and do not change that reasoning.
--
-- Apply with `pnpm --filter @bebest/database run db:apply`
-- (packages/database/scripts/apply-sql.mjs). No explicit BEGIN/COMMIT — the
-- runner already wraps each file in its own transaction.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_billing_event_at TIMESTAMPTZ(6);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_billing_event_id VARCHAR(255);

ALTER TABLE billing_webhook_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ(6);
ALTER TABLE billing_webhook_events ADD COLUMN IF NOT EXISTS skipped_reason VARCHAR(50);
