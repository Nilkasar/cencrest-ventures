import { db, type Prisma } from '@bebest/database';

export interface AuditEventInput {
  userId: string | null;
  organizationId: string | null;
  actorType: 'user' | 'system' | 'agent';
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
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
] as const;
