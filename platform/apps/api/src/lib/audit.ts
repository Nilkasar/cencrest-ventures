import { db, withOrgContext, type Prisma } from '@bebest/database';

export interface AuditEventInput {
  userId: string | null;
  organizationId: string | null;
  actorType: 'user' | 'system' | 'agent';
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result: 'success' | 'failure';
  oldValue?: unknown;
  newValue?: unknown;
  details?: Record<string, unknown>;
}

/**
 * Writes one row to `audit_events`.
 *
 * An org-attributed event is written inside that org's context; a
 * platform-level one (no organization — login, logout, webhook receipt)
 * goes through the un-scoped client. `audit_events`'s append policy accepts
 * exactly those two shapes (migration 0021).
 *
 * This used to be a single un-scoped insert, with a note deferring the
 * scoped version until "integration tests exist against a real Postgres
 * instance". Those exist now, and they showed the deferral was not
 * harmless: under a role that cannot bypass RLS, every org-scoped audit
 * write was refused with `42501` and — because this function swallows its
 * own failures — the trail simply stopped, silently, while the actions it
 * was meant to record carried on succeeding.
 *
 * Never throws: a failure to write an audit log must not take down the
 * privileged action it was trying to record. Logs to stderr instead so the
 * failure is at least observable.
 */
/** The exact `audit_events` row shape both writers below insert. One place, so
 * a transactional write and a best-effort write can never record different
 * things for the same event. */
function auditEventData(input: AuditEventInput) {
  return {
    user_id: input.userId,
    organization_id: input.organizationId,
    actor_type: input.actorType,
    actor_role: input.actorRole ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    result: input.result,
    old_value: input.oldValue as Prisma.InputJsonValue | undefined,
    new_value: input.newValue as Prisma.InputJsonValue | undefined,
    details: (input.details ?? {}) as Prisma.InputJsonValue,
  };
}

/**
 * Writes the audit row inside a transaction the CALLER owns — and, unlike
 * `writeAuditEvent` below, THROWS if it cannot.
 *
 * That inversion is deliberate and narrow. `writeAuditEvent` swallows failures
 * because an audit write must not break the action it records; but inside a
 * transaction a failed INSERT has already aborted the transaction, so
 * swallowing it would only hide the fact that everything after it is doomed.
 * Worse, the one caller that needs this — `routes/billing-webhooks.ts` — is
 * atomic precisely so that a partially-applied event cannot exist: if the audit
 * row cannot be written, the right outcome is that the billing change rolls
 * back and the provider retries the whole event, not that the change lands
 * unaudited.
 *
 * `organizationId` must be the org whose context `tx` was opened with —
 * `audit_events`'s append policy (migration 0021) accepts only a row whose
 * `organization_id` is null or equal to `app.current_org`.
 */
export async function writeAuditEventWithin(tx: Prisma.TransactionClient, input: AuditEventInput): Promise<void> {
  await tx.audit_events.create({ data: auditEventData(input) });
}

export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    // An org-attributed row is written INSIDE that org's context.
    //
    // `audit_events` has RLS, and its append policy only accepts a row whose
    // `organization_id` is null or matches `app.current_org`. Writing
    // through the un-scoped client therefore failed with `42501 new row
    // violates row-level security policy` for every org-scoped event — and
    // because this function deliberately swallows its own failures, the
    // audit trail silently stopped recording under a correctly-privileged
    // role. See migration 0021 for the policy half of this fix.
    //
    // Platform-level events (no organization: login, logout, webhook
    // receipt) keep using the un-scoped client — they have no context to
    // set, and the policy explicitly allows a null organization.
    const data = auditEventData(input);

    if (input.organizationId) {
      await withOrgContext(input.organizationId, (tx) => writeAuditEventWithin(tx, input));
    } else {
      await db.audit_events.create({ data });
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'audit_event_write_failed',
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Actions that SECURITY.md requires ALWAYS generate an audit log,
 * transcribed verbatim from its "Actions that ALWAYS generate audit log"
 * list, as a shared vocabulary for route handlers and the `auditLog`
 * middleware to reference instead of inventing ad hoc action strings. */
export const ALWAYS_AUDITED_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.login_failed',
  'membership.role_changed',
  'billing.changed',
  'content.published',
  'agent.action',
  'api_key.created',
  'api_key.rotated',
  'api_key.deleted',
  'organization.deleted',
  'settings.changed',
  'data.exported',
  // Epic 1 (CRM) additions — not in SECURITY.md's literal list (written
  // before this epic existed), but docs/epics/01-crm.md explicitly calls
  // out deal stage transitions as privileged ("treat 'moved a $65k deal to
  // Won' as privileged") and lead conversion creates/links a real
  // organization, which is exactly the shape of action this list exists to
  // cover.
  'lead.converted',
  'deal.stage_changed',
  // Epic 16 (Billing) addition — a rejected webhook (bad/tampered
  // signature) is exactly the "security-relevant event" SECURITY.md's audit
  // requirement exists for, distinct from `billing.changed` (a legitimate,
  // successfully-applied billing change) — see routes/billing-webhooks.ts.
  'billing.webhook_rejected',
  // A well-signed billing event that was deliberately NOT applied because a
  // newer one had already been (see routes/billing-webhooks.ts's ordering
  // guard). Recorded for the same reason as the rejection above: an event that
  // changed nothing still has to be explainable when someone reconciles an
  // account's billing history.
  'billing.webhook_superseded',
  // Epic 18 (Agency / White Label / Integrations) additions — every step of
  // the cross-org consent lifecycle this epic's DoD requires ("requires the
  // documented consent/invitation step... and is audit-logged", "revoking a
  // link immediately blocks a subsequent request") is exactly the class of
  // event SECURITY.md's audit list exists for: it changes WHICH org id a
  // request can assert, the same security-relevant weight as
  // `membership.role_changed`. `integration.connected`/`.disconnected`
  // guard a credential-shaped resource (`integrations.config_enc`) even
  // though this build's provider is mocked.
  'agency_client.invited',
  'agency_client.consented',
  'agency_client.revoked',
  'integration.connected',
  'integration.disconnected',
  // Epic 11 (Content Intelligence & Generation) addition — SECURITY.md's
  // list already names `content.published` (Epic 13's concern); this epic
  // never publishes, but its own spec explicitly calls out that "the
  // approval action itself should be logged now" — a human approving a
  // draft is the privileged decision this epic's whole ADR-007 gate exists
  // to record, distinct from (and a prerequisite to) the eventual publish.
  'content.approved',
  // Epic 13 (Action Center & Controlled Publishing) additions —
  // `content.published` above IS this epic's `POST /actions/:id/execute`
  // event (SECURITY.md's literal "Publishing content" entry, reused
  // verbatim, see routes/action-details.ts). `action.approved` records the
  // owner/admin decision that GATES that publish (this epic's own
  // non-negotiable: "no code path exists that publishes without a prior
  // approved_at timestamp set by a real user action" — that timestamp's
  // own setting is exactly the privileged event this list exists to
  // capture). `action.rolled_back` records reverting an already-published
  // record within the 30-day window — undoing a "Publishing content" event
  // is the same class of security-relevant action as the event itself.
  'action.approved',
  'action.rolled_back',
  // Epic 14 (Measurement & Learning Loop) addition — a system-triggered
  // re-measurement is an autonomous agent action in the same sense
  // `agent.action` already covers (SECURITY.md's "autonomous agent
  // actions" always-audit entry) — this epic's own transparency
  // requirement, verbatim: "must be observable (log/event) per the
  // transparency principle every agent epic follows." See
  // `lib/measurement/run-measurement.ts`.
  'measurement.completed',
  // Epic 15 (Reporting & Notifications) additions — this epic's own
  // explicit requirement, verbatim: "Audit logging on report generation
  // and notification creation, matching the existing audit-logging
  // helper." `report.generated` is written by
  // `lib/reporting/generate-report.ts` for every one of the four report
  // types; `notification.sent` is written once per channel actually
  // attempted (in_app always, email when a recipient resolves) by the
  // shared `lib/notifications/notify.ts` — the single mechanism every
  // notification in this codebase (agent-run completion, competitor
  // movement, report-ready) now routes through.
  'report.generated',
  'notification.sent',
] as const;
