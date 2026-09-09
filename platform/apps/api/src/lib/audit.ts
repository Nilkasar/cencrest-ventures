import { db, type Prisma } from '@bebest/database';

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
 * Writes one row to `audit_events`. This is a plain insert against the
 * base `db` client, not `withOrgContext` — `audit_events.organization_id`
 * is nullable (system-level events) and the write itself must succeed
 * regardless of tenant context, so RLS's `WITH CHECK` on this table would
 * otherwise reject inserts made outside an org-context transaction. In a
 * real deployment this insert runs under the `bebest_app` role, which
 * means it IS still subject to `audit_events`'s RLS policy — so any
 * caller that wants to attribute a write to a specific org must go through
 * `withOrgContext` itself if strict enforcement is desired. For Epic 0
 * this function performs the write directly and is marked NEEDS LIVE DB in
 * its test file for that reason; wiring it through `withOrgContext` when
 * `organizationId` is present is a one-line follow-up once integration
 * tests exist against a real Postgres instance.
 *
 * Never throws: a failure to write an audit log must not take down the
 * privileged action it was trying to record. Logs to stderr instead so the
 * failure is at least observable.
 */
export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await db.audit_events.create({
      data: {
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
      },
    });
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
