/**
 * Epic 11 (Content Intelligence & Generation) — `GET /content-drafts/:id`,
 * `GET /content-drafts/:id/quality-checks`, and `POST
 * /content-drafts/:id/approve` (`docs/epics/11-content-intelligence-
 * generation.md`'s "API surface" + generation pipeline step 5: "Present for
 * human approval — ALWAYS, regardless of autonomy level").
 *
 * ADR-007, enforced by absence, not convention: nothing in this file (or
 * anywhere else in this epic) imports/calls anything shaped like a publish
 * action. Approving sets `content_drafts.status` to `'approved'` — a value
 * this table's own CHECK constraint (`chk_content_drafts_status`) limits to
 * `'generated'|'approved'`, so a `'published'` status is not even
 * representable here, let alone reachable by this route.
 *
 * Epic 13 (Action Center & Controlled Publishing) addition: right after a
 * draft is approved, this route also creates the pending `actions` row
 * that hands the draft off to Epic 13's own approve -> execute -> rollback
 * lifecycle (`actions.content_draft_id`, a real FK, never a re-typed copy —
 * see `@bebest/database` DECISIONS.md §27's "Handoff wiring" section for
 * why THIS is the insertion point). This is still not a publish action —
 * it creates a `pending` Action Center entry, nothing more; ADR-007's
 * boundary above is unchanged. Relies on this handler's OWN idempotency
 * short-circuit (below) for its idempotency, backed up by
 * `actions.content_draft_id`'s DB-level `@unique` as a second line of
 * defense.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { hasPermission } from '../lib/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { serializeApproval, serializeBrief, serializeDraft, serializeQualityCheck } from '../lib/content/serialize.js';
import type { AppEnv } from '../types/context.js';

const contentDraftsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const NOT_FOUND_ERROR = { error: 'Content draft not found' } as const;

contentDraftsRoute.get('/:id', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const draft = await withOrgContext(org.organizationId, (tx) =>
    tx.content_drafts.findFirst({ where: { id: c.req.param('id'), organization_id: org.organizationId }, include: { content_briefs: true } }),
  );
  if (!draft) return c.json(NOT_FOUND_ERROR, 404);

  // This epic's UI surface requirement, verbatim: "the approval screen must
  // show the draft alongside its brief's original requirements — a
  // reviewer approving blind, without the brief in view, defeats the point
  // of the approval gate." One call gives the frontend both.
  return c.json({ draft: serializeDraft(draft), brief: serializeBrief(draft.content_briefs) });
});

contentDraftsRoute.get('/:id/quality-checks', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const draftId = c.req.param('id');

  const draft = await withOrgContext(org.organizationId, (tx) => tx.content_drafts.findFirst({ where: { id: draftId, organization_id: org.organizationId } }));
  if (!draft) return c.json(NOT_FOUND_ERROR, 404);

  // Epic 19 (Production Hardening), item 6 — capped server-side for
  // consistency with every other list endpoint in this codebase, though
  // this one is naturally small (quality checks run once per draft
  // generation).
  const checks = await withOrgContext(org.organizationId, (tx) =>
    tx.content_quality_checks.findMany({ where: { draft_id: draftId, organization_id: org.organizationId }, orderBy: { created_at: 'asc' }, take: 100 }),
  );

  return c.json({ draftId, checks: checks.map(serializeQualityCheck) });
});

const approveBodySchema = z.object({ notes: z.string().max(2000).optional() });

// `approve_content` needs `isOwnResource` (an `editor` may approve only a
// draft they themselves triggered generation of) computed from the DRAFT
// row itself, which is not known until it's loaded — `requirePermission`'s
// `resolveOpts` is synchronous and only sees the request (see
// `middleware/rbac.ts`), so it cannot do that DB lookup. This route
// therefore checks auth/org membership via the normal middleware chain,
// then calls `hasPermission` directly once the draft (and hence its
// `created_by`) is actually in hand — same underlying SECURITY.md matrix,
// just evaluated at the point its inputs exist, never skipped or weakened.
contentDraftsRoute.post('/:id/approve', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const draftId = c.req.param('id');

  const body = await c.req.json().catch(() => ({}));
  const parsed = approveBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  // `include: content_briefs` — needed below to populate the Epic 13
  // handoff's `recommendation_id`/`title`/`evidence_summary` from the
  // draft's own brief, without a second round trip.
  const draft = await withOrgContext(org.organizationId, (tx) =>
    tx.content_drafts.findFirst({ where: { id: draftId, organization_id: org.organizationId }, include: { content_briefs: true } }),
  );
  if (!draft) return c.json(NOT_FOUND_ERROR, 404);

  const isOwnResource = draft.created_by !== null && draft.created_by === user.id;
  if (!hasPermission(org.role, 'approve_content', { isOwnResource })) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  // Idempotent: a second approve on an already-approved draft returns the
  // existing approval rather than erroring or duplicating (`content_approvals.
  // draft_id` is `@unique`) — no new audit event on the repeat, since
  // nothing actually changed.
  const existing = await withOrgContext(org.organizationId, (tx) => tx.content_approvals.findFirst({ where: { draft_id: draft.id, organization_id: org.organizationId } }));
  if (existing) {
    return c.json({ alreadyApproved: true, approval: serializeApproval(existing), draft: serializeDraft(draft) }, 200);
  }

  const approval = await withOrgContext(org.organizationId, (tx) =>
    tx.content_approvals.create({
      data: {
        organization_id: org.organizationId,
        brand_id: draft.brand_id,
        draft_id: draft.id,
        approved_by: user.id,
        approved_role: org.role,
        notes: parsed.data.notes ?? null,
      },
    }),
  );

  // "approved, ready to publish" — never 'published' (ADR-007; see this
  // file's own header comment). Epic 13 is the only future code that ever
  // moves a draft past this point, and it does so through its OWN table
  // (`actions`, created just below) — never by mutating THIS row further.
  const updatedDraft = await withOrgContext(org.organizationId, (tx) => tx.content_drafts.update({ where: { id: draft.id }, data: { status: 'approved', updated_at: new Date() } }));

  // Epic 13 handoff — real FK (`content_draft_id`), never a re-typed copy
  // of the draft's own fields. Not itself audit-logged: the privileged
  // decision it follows (`content.approved`, just below) already is, and
  // this is bookkeeping for that same decision, not a second one. See this
  // file's own header comment.
  await withOrgContext(org.organizationId, (tx) =>
    tx.actions.create({
      data: {
        organization_id: org.organizationId,
        brand_id: draft.brand_id,
        action_type: 'publish_content',
        title: `Publish: ${updatedDraft.title ?? draft.content_briefs.title}`,
        description: draft.content_briefs.evidence_summary,
        status: 'pending',
        autonomy_level: 1,
        recommendation_id: draft.content_briefs.recommendation_id,
        content_draft_id: draft.id,
        created_by: user.id,
      },
    }),
  );

  await writeManualAuditEvent(c, { action: 'content.approved', entityType: 'content_draft', entityId: draft.id });

  return c.json({ alreadyApproved: false, approval: serializeApproval(approval), draft: serializeDraft(updatedDraft) }, 201);
});

export default contentDraftsRoute;
