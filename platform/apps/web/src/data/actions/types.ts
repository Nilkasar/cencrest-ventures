/**
 * Epic 13 — Action Center & Controlled Publishing domain model.
 *
 * Mirrors `apps/api/src/lib/actions/serialize.ts`, `routes/actions.ts`, and
 * `routes/action-details.ts` field-for-field (read the actual backend
 * source directly before writing this file, not guessed from
 * `docs/epics/13-action-center-publishing.md`'s prose) — every field is
 * camelCase because the API already returns a camelCase, whitelisted
 * object, same "comes across as-is" convention `data/content/types.ts`/
 * `data/agents/types.ts` already establish. `ContentBrief`/`ContentDraft`
 * are imported from Epic 11's own module rather than re-declared here —
 * `GET /brands/me/actions` inlines the exact same shape `data/content/
 * client.ts` already types (`routes/actions.ts`'s `ACTION_INCLUDE` +
 * `serializeActionWithContext`), real reuse of a real shared shape, not a
 * coincidental duplicate.
 */
import type { ContentBrief, ContentDraft } from "@/data/content/types";

/** `actions.status` — the real, widened approve -> execute -> rollback
 *  lifecycle (`packages/database/prisma/migrations/
 *  0016_action_center_publishing/checks.sql`'s `chk_actions_status`), not
 *  Epic 0's never-consumed placeholder vocabulary. */
export type ActionStatus = "pending" | "approved" | "completed" | "rolled_back";

/** `actions.priority` — untouched by this epic
 *  (`0000_init/checks.sql`'s `chk_actions_priority`). */
export type ActionPriority = "low" | "medium" | "high" | "critical";

/**
 * `actions.autonomy_level` — deliberately representable as `1-4` at this
 * layer, NOT narrowed to `1-3` the way `data/agents/types.ts`'s
 * `AutonomyLevel` safely is. This epic's own non-negotiable requires the
 * Level 4 block be provable even against a row that legitimately holds `4`
 * (a manually-crafted/corrupted row — `chk_actions_autonomy_level` allows
 * it at the DB layer on purpose, see that constraint's own comment) — the
 * UI mirrors that by staying able to REPRESENT `4` (and refusing to ever
 * offer Approve/Execute for it, `action-card.tsx`), rather than making `4`
 * an impossible type the way Epic 12's trigger-only UI safely could.
 */
export type ActionAutonomyLevel = 1 | 2 | 3 | 4;

/** Open JSONB (`actions.result`). Set only by `POST /:id/execute`
 *  (`{ publishedContentId, destinationRef }`) — never cleared by rollback,
 *  so it stays the last-known publish pointer even on a rolled-back
 *  action. `null` for a pending/approved action that hasn't executed yet. */
export interface ActionResult {
  publishedContentId?: string;
  destinationRef?: string;
  [key: string]: unknown;
}

export interface Action {
  id: string;
  brandId: string;
  recommendationId: string | null;
  actionType: string;
  title: string;
  description: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  autonomyLevel: ActionAutonomyLevel;
  /** The two handoff sources this epic's spec names by name — mutually
   *  exclusive per row (`chk_actions_single_handoff_source`): an approved
   *  `content_drafts` row (Epic 11) or an approved `agent_pending_actions`
   *  row (Epic 12). Both `null` for a directly-created action (not
   *  exercised by this build, but not precluded by the schema either). */
  contentDraftId: string | null;
  agentPendingActionId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  rolledBackAt: string | null;
  result: ActionResult | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /brands/me/actions`'s per-row shape — `serializeActionWithContext`
 *  (`routes/actions.ts`) inlines the underlying `content_drafts`/
 *  `content_briefs` row so a reviewer never has to make a second call to
 *  see what they're approving (this epic's own literal UI requirement:
 *  "the underlying recommendation/content draft shown inline, not just a
 *  title"). Both `null` for an agent-originated action
 *  (`agentPendingActionId` set instead — see `action-origin.tsx`) or a
 *  directly-created one. */
export interface ActionWithContext extends Action {
  contentDraft: ContentDraft | null;
  contentBrief: ContentBrief | null;
}

/** `GET /brands/me/actions`'s response — the Action Center's four literal
 *  sections, matching `docs/09-ux/CUSTOMER_JOURNEY.md`'s Actions screen
 *  exactly: pending approvals, in-progress (approved, awaiting execution),
 *  completed (executed), rolled-back. */
export interface ActionsOverview {
  pending: ActionWithContext[];
  inProgress: ActionWithContext[];
  completed: ActionWithContext[];
  rolledBack: ActionWithContext[];
}

/** `PublishTarget.name` (`apps/api/src/lib/actions/publish-target.ts`) —
 *  `"internal_record"` for the one implementation this build ships
 *  (`NullPublishTarget`); kept open (not a closed union) so a future real
 *  CMS adapter's own name needs no type change here. */
export type PublishTargetName = "internal_record" | (string & {});

/**
 * `serializePublishedContent` (`lib/actions/serialize.ts`). Only ever
 * returned inline by the execute/rollback POST responses themselves —
 * there is no `GET /published-content/:id` route anywhere in this epic's
 * backend, so this shape is never independently re-fetched after the
 * mutating call that produced it (see this app's own frontend completion
 * doc's "Known limitations").
 */
export interface PublishedContent {
  id: string;
  brandId: string;
  actionId: string;
  publishTarget: PublishTargetName;
  /** Where the content now "lives." Always an `internal://...` locator for
   *  `NullPublishTarget` — NEVER a real external URL, this epic's explicit,
   *  documented scope boundary (no real CMS integration exists yet). */
  destinationRef: string;
  title: string | null;
  body: string | null;
  status: "published" | "rolled_back";
  publishedAt: string;
  publishedBy: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  result: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `POST /actions/:id/approve`'s response — idempotent, so
 *  `alreadyApproved` distinguishes "just approved" from "was already
 *  approved" without the caller comparing timestamps itself. */
export interface ApproveActionResult {
  alreadyApproved: boolean;
  action: Action;
}

/** `POST /actions/:id/execute`'s response. `publishedContent` is always
 *  present on the real (non-idempotent) path — `201`, `alreadyExecuted:
 *  false` — and on the idempotent re-call as long as the original
 *  `published_content` row is still findable; `null` only in the
 *  theoretical case it was hard-deleted between the two calls. */
export interface ExecuteActionResult {
  alreadyExecuted: boolean;
  action: Action;
  publishedContent: PublishedContent | null;
}

/** `POST /actions/:id/rollback`'s response — same idempotency shape as
 *  execute above. */
export interface RollbackActionResult {
  alreadyRolledBack: boolean;
  action: Action;
  publishedContent: PublishedContent | null;
}
