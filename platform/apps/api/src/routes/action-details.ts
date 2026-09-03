/**
 * Epic 13 (Action Center & Controlled Publishing) — `POST
 * /actions/:id/approve`, `POST /actions/:id/execute` (deliberately SEPARATE
 * from approve — "a human might approve now and the system executes async",
 * spec verbatim), and `POST /actions/:id/rollback`. An `actions` row is
 * addressed by its own id, not a brand's — same "id-addressed sibling of a
 * brand-scoped list route" precedent `ai-run-details.ts`/
 * `opportunity-details.ts`/`agent-run-details.ts` already set.
 *
 * ADR-007's enforcement point, concretely: this file is the ONLY code in
 * this build that ever creates a `published_content` row, and it does so
 * through exactly one guarded path.
 *
 * RBAC: all three routes gate on `publish_content` (owner/admin only) —
 * this epic's own task brief, verbatim: "per docs/08-security/SECURITY.md's
 * 'Publish content: owner/admin only'." Not `approve_content`
 * (owner/admin/editor-own) — that is Epic 11's OWN draft-quality gate, a
 * different, looser permission for a different decision. SECURITY.md's
 * matrix has exactly one row for the whole publish-shaped decision
 * (approve -> execute -> rollback alike).
 */
import { Hono } from 'hono';
import { withOrgContext, type actions, type Prisma } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getPublishTarget } from '../lib/actions/publish-target.js';
import { isWithinRollbackWindow } from '../lib/actions/rollback-window.js';
import { serializeAction, serializePublishedContent } from '../lib/actions/serialize.js';
import { getCurrentScoreSnapshot } from '../lib/measurement/current-score-snapshot.js';
import { scheduleRemeasurement } from '../lib/measurement/schedule-remeasurement.js';
import type { AppEnv } from '../types/context.js';

const actionDetailsRoute = new Hono<AppEnv>();

// This epic's task brief, verbatim: "owner/admin-only approve action per
// docs/08-security/SECURITY.md" — reused for execute/rollback too, see this
// file's own header comment.
const PUBLISH = 'publish_content' as const;

const NOT_FOUND_ERROR = { error: 'Action not found' } as const;

const LEVEL4_REJECTED_ERROR = {
  error: 'autonomy_level_rejected',
  message: 'Level 4 (fully autonomous) actions are not available. They can never be approved or executed by this build.',
} as const;

/** Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit WHERE)
 * as every other id-addressed route in this codebase — a foreign id 404s,
 * never a 403 that would confirm it exists (tenant isolation). */
async function getAction(organizationId: string, id: string, include?: { content_drafts: true }) {
  return withOrgContext(organizationId, (tx) =>
    tx.actions.findFirst({ where: { id, organization_id: organizationId, deleted_at: null }, include }),
  );
}

// ── POST /:id/approve ───────────────────────────────────────────────────
// Sets `approved_by`/`approved_at` from the REAL authenticated caller —
// never client-supplied (this epic's non-negotiable, concretely: there is
// no request-body field this handler ever reads for either value).
// Idempotent: a second approve on an already-approved action returns the
// existing state rather than re-approving or re-auditing.
//
// Also rejects a Level 4 action here, not only at execute — an action that
// can never execute has no meaningful "approved" state to enter; this is
// additional hardening on top of this epic's own required guarantee (the
// execute-path rejection below), not a substitute for it.
actionDetailsRoute.post('/:id/approve', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(PUBLISH), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const action = await getAction(org.organizationId, c.req.param('id'));
  if (!action) return c.json(NOT_FOUND_ERROR, 404);

  if (action.autonomy_level >= 4) return c.json(LEVEL4_REJECTED_ERROR, 422);

  if (action.approved_at) {
    return c.json({ alreadyApproved: true, action: serializeAction(action) }, 200);
  }

  const now = new Date();

  // Epic 14 (Measurement & Learning Loop) non-negotiable: the before-score
  // must be snapshotted AT APPROVAL TIME, not measurement time — this is
  // that snapshot, the ONLY place it is ever taken (see `actions.
  // before_score`'s own schema comment and `lib/measurement/current-score-
  // snapshot.ts`'s header comment for the full reasoning). A read of
  // whatever is ALREADY computed (Epic 7's latest completed `ai_runs`,
  // Epic 4's latest `seo_analyses`) — never a trigger of a brand-new AI run
  // or crawl just to record a baseline.
  const beforeScore = await getCurrentScoreSnapshot(org.organizationId, action.brand_id);

  const updated = await withOrgContext(org.organizationId, (tx) =>
    tx.actions.update({
      where: { id: action.id },
      data: {
        approved_by: user.id,
        approved_at: now,
        status: 'approved',
        updated_by: user.id,
        updated_at: now,
        before_score: beforeScore as unknown as Prisma.InputJsonValue,
        before_score_captured_at: now,
      },
    }),
  );

  // `actions.approved`/`.executed`/`.rolled_back` — this epic's own
  // additions to ALWAYS_AUDITED_ACTIONS (lib/audit.ts), the privileged
  // "human authorized this specific publish decision" record SECURITY.md's
  // "Publishing content" always-audit rule exists for.
  await writeManualAuditEvent(c, { action: 'action.approved', entityType: 'action', entityId: action.id });

  return c.json({ alreadyApproved: false, action: serializeAction(updated) }, 200);
});

const NOT_APPROVED_ERROR = {
  error: 'not_approved',
  message: 'This action has not been approved yet. Call POST /actions/:id/approve first.',
} as const;

/** Builds the `PublishInput.title`/`.body` this action's execute should
 * publish — from the linked `content_drafts` row when the action
 * originated from one (Epic 11 handoff), falling back to the action's own
 * `title`/`description` for a Level 1-3 agent-originated action with no
 * draft. Never fabricates content the action doesn't actually carry. */
function resolvePublishContent(action: actions & { content_drafts?: { title: string | null; body: string } | null }): { title: string; body: string | null } {
  if (action.content_drafts) return { title: action.content_drafts.title ?? action.title, body: action.content_drafts.body };
  return { title: action.title, body: action.description };
}

// ── POST /:id/execute ─────────────────────────────────────────────────────
// SEPARATE from approve (spec, verbatim: "a human might approve now and the
// system executes async"). The two guard clauses below are this epic's own
// non-negotiable, readable directly in this function's source, not merely
// documented:
//   1. Level 4 is rejected UNCONDITIONALLY — checked before the approval
//      check, so a manually-crafted row with `approved_at` ALSO set (the
//      spec's own defense-in-depth scenario) is still rejected.
//   2. Execution without a prior `approved_at` is rejected — "no code path
//      exists that publishes without a prior approved_at timestamp set by
//      a real user action" (this epic's Non-negotiable section, verbatim).
// Only past both does a `published_content` row ever get created.
actionDetailsRoute.post('/:id/execute', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(PUBLISH), async (c) => {
  const org = c.get('org');
  const action = await getAction(org.organizationId, c.req.param('id'), { content_drafts: true });
  if (!action) return c.json(NOT_FOUND_ERROR, 404);

  // Guard clause 1 — Level 4, unconditional. Deliberately evaluated BEFORE
  // the approval check immediately below, so this rejection fires
  // regardless of whatever `approved_at`/`approved_by` a manually-crafted
  // row happens to carry (Epic 12 already blocks Level 4 from ever being
  // TRIGGERED — this is the independent, second block on the EXECUTE side).
  if (action.autonomy_level >= 4) return c.json(LEVEL4_REJECTED_ERROR, 422);

  // Guard clause 2 — no execute without a prior real approval.
  if (!action.approved_at) return c.json(NOT_APPROVED_ERROR, 409);

  // Idempotent: a second execute call on an already-executed action returns
  // the existing published_content record rather than publishing twice
  // (`published_content.action_id` is also `@unique` at the DB layer — this
  // is the application-level mirror of that same invariant).
  if (action.executed_at) {
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.published_content.findFirst({ where: { action_id: action.id, organization_id: org.organizationId } }),
    );
    return c.json({ alreadyExecuted: true, action: serializeAction(action), publishedContent: existing ? serializePublishedContent(existing) : null }, 200);
  }

  const { title, body } = resolvePublishContent(action);
  const target = getPublishTarget();
  const publishResult = await target.publish({ actionId: action.id, organizationId: org.organizationId, brandId: action.brand_id, title, body });

  const now = new Date();
  const publishedContent = await withOrgContext(org.organizationId, (tx) =>
    tx.published_content.create({
      data: {
        organization_id: org.organizationId,
        brand_id: action.brand_id,
        action_id: action.id,
        publish_target: target.name,
        destination_ref: publishResult.destinationRef,
        title,
        body,
        status: 'published',
        published_at: now,
        published_by: action.approved_by,
        result: publishResult.result as Prisma.InputJsonValue,
      },
    }),
  );

  const updated = await withOrgContext(org.organizationId, (tx) =>
    tx.actions.update({
      where: { id: action.id },
      data: {
        executed_at: now,
        status: 'completed',
        completed_at: now,
        result: { publishedContentId: publishedContent.id, destinationRef: publishResult.destinationRef } as Prisma.InputJsonValue,
      },
    }),
  );

  // `content.published` — SECURITY.md's ALWAYS_AUDITED_ACTIONS "Publishing
  // content" entry, reused verbatim (this IS that event).
  await writeManualAuditEvent(c, { action: 'content.published', entityType: 'action', entityId: action.id });

  // Epic 14 (Measurement & Learning Loop) — "Triggered automatically 4
  // weeks after an actions row's executed_at," the spec's own literal
  // trigger point. Only on this REAL, first-time execution branch — never
  // on the idempotent `alreadyExecuted` branch above, which would otherwise
  // schedule a second, redundant re-measurement timer for the same action
  // on every repeated call.
  scheduleRemeasurement(action.id, org.organizationId);

  return c.json({ alreadyExecuted: false, action: serializeAction(updated), publishedContent: serializePublishedContent(publishedContent) }, 201);
});

const NOT_EXECUTED_ERROR = {
  error: 'not_executed',
  message: 'This action has not been executed yet. There is nothing to roll back.',
} as const;

const ROLLBACK_WINDOW_EXPIRED_ERROR = {
  error: 'rollback_window_expired',
  message: 'The 30-day rollback window for this action has expired.',
} as const;

// ── POST /:id/rollback ────────────────────────────────────────────────────
// Reverts `published_content`'s status (spec, verbatim) within the 30-day
// window measured from `executed_at` (lib/actions/rollback-window.ts — a
// resolved ambiguity, see that file's own header comment). Rejects with a
// SPECIFIC error after 30 days, never silently allowing it.
actionDetailsRoute.post('/:id/rollback', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(PUBLISH), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const action = await getAction(org.organizationId, c.req.param('id'));
  if (!action) return c.json(NOT_FOUND_ERROR, 404);

  if (!action.executed_at) return c.json(NOT_EXECUTED_ERROR, 409);

  if (action.rolled_back_at) {
    const existing = await withOrgContext(org.organizationId, (tx) =>
      tx.published_content.findFirst({ where: { action_id: action.id, organization_id: org.organizationId } }),
    );
    return c.json({ alreadyRolledBack: true, action: serializeAction(action), publishedContent: existing ? serializePublishedContent(existing) : null }, 200);
  }

  // The real, tested 30-day check — a rollback attempted after the window
  // is rejected with a specific, distinguishable error, never silently
  // allowed and never conflated with "not executed yet" above.
  if (!isWithinRollbackWindow(action.executed_at)) {
    return c.json(ROLLBACK_WINDOW_EXPIRED_ERROR, 409);
  }

  const publishedContent = await withOrgContext(org.organizationId, (tx) =>
    tx.published_content.findFirst({ where: { action_id: action.id, organization_id: org.organizationId } }),
  );

  const now = new Date();

  if (publishedContent) {
    // Best-effort target-side rollback — never blocks the DB-recorded
    // rollback below (see PublishTarget.rollback's own doc comment for
    // why: the row updates ARE the source of truth this guarantee rests
    // on, not whatever the target itself does or doesn't do).
    try {
      await getPublishTarget().rollback(publishedContent.destination_ref);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'publish_target_rollback_failed', actionId: action.id, error: err instanceof Error ? err.message : String(err) }));
    }

    await withOrgContext(org.organizationId, (tx) =>
      tx.published_content.update({
        where: { id: publishedContent.id },
        data: { status: 'rolled_back', rolled_back_at: now, rolled_back_by: user.id },
      }),
    );
  }

  const updated = await withOrgContext(org.organizationId, (tx) =>
    tx.actions.update({
      where: { id: action.id },
      data: { rolled_back_at: now, status: 'rolled_back', updated_by: user.id, updated_at: now },
    }),
  );

  await writeManualAuditEvent(c, { action: 'action.rolled_back', entityType: 'action', entityId: action.id });

  return c.json({ alreadyRolledBack: false, action: serializeAction(updated) }, 200);
});

export default actionDetailsRoute;
