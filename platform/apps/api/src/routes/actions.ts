/**
 * Epic 13 (Action Center & Controlled Publishing) — `GET /brands/me/actions`
 * (`docs/epics/13-action-center-publishing.md`'s "API surface": "pending
 * approvals, in-progress, completed, rolled-back" — matches
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Action Center screen sections exactly).
 *
 * Spec's literal route is `GET /brands/:id/actions`; adapted to
 * `/brands/me/actions`, the single-brand-per-org convention every Epic 2+
 * route in `app.ts` already uses (see that file's own per-route comments,
 * e.g. Epic 12's `/brands/:id/agents/...` -> `/brands/me/agents`
 * adaptation) — not a fresh decision here, applying an established
 * precedent.
 *
 * The id-addressed lifecycle mutations (`POST /actions/:id/approve` /
 * `/execute` / `/rollback`) live in `routes/action-details.ts`, same
 * "second router, id-addressed sibling of a brand-scoped list route" split
 * every prior epic in this codebase uses (`ai-runs.ts` vs.
 * `ai-run-details.ts`, `opportunities.ts` vs. `opportunity-details.ts`,
 * `agents.ts` vs. `agent-run-details.ts`).
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { serializeAction } from '../lib/actions/serialize.js';
import { serializeBrief, serializeDraft } from '../lib/content/serialize.js';
import type { AppEnv } from '../types/context.js';

const actionsRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;

// Per this epic's UI surface requirement, verbatim: "pending approvals
// (with the underlying recommendation/draft visible inline, not just a
// title)... link forward/backward between screens rather than treating
// Actions as an isolated list." `content_drafts` is included with its own
// `content_briefs` nested one level further, matching `GET
// /content-drafts/:id`'s own "draft alongside its brief" precedent
// (routes/content-drafts.ts) — a reviewer never has to make a second call
// to see what they're approving.
const ACTION_INCLUDE = { content_drafts: { include: { content_briefs: true } } } as const;

function serializeActionWithContext(row: Parameters<typeof serializeAction>[0] & { content_drafts?: (Parameters<typeof serializeDraft>[0] & { content_briefs?: Parameters<typeof serializeBrief>[0] }) | null }) {
  return {
    ...serializeAction(row),
    contentDraft: row.content_drafts ? serializeDraft(row.content_drafts) : null,
    contentBrief: row.content_drafts?.content_briefs ? serializeBrief(row.content_drafts.content_briefs) : null,
  };
}

// ── GET / — the Action Center's four sections, matching CUSTOMER_JOURNEY.md
// exactly: pending approvals, in-progress (approved, awaiting execution),
// completed (executed), rolled-back. ───────────────────────────────────────
actionsRoute.get('/', requireAuth, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  const baseWhere = { organization_id: org.organizationId, brand_id: brand.id, deleted_at: null };

  const [pending, inProgress, completed, rolledBack] = await withOrgContext(org.organizationId, (tx) =>
    Promise.all([
      tx.actions.findMany({ where: { ...baseWhere, status: 'pending' }, include: ACTION_INCLUDE, orderBy: { created_at: 'desc' } }),
      tx.actions.findMany({ where: { ...baseWhere, status: 'approved' }, include: ACTION_INCLUDE, orderBy: { approved_at: 'desc' } }),
      tx.actions.findMany({ where: { ...baseWhere, status: 'completed' }, include: ACTION_INCLUDE, orderBy: { executed_at: 'desc' } }),
      tx.actions.findMany({ where: { ...baseWhere, status: 'rolled_back' }, include: ACTION_INCLUDE, orderBy: { rolled_back_at: 'desc' } }),
    ]),
  );

  return c.json({
    pending: pending.map(serializeActionWithContext),
    inProgress: inProgress.map(serializeActionWithContext),
    completed: completed.map(serializeActionWithContext),
    rolledBack: rolledBack.map(serializeActionWithContext),
  });
});

export default actionsRoute;
