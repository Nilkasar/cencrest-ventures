"use client";

import { CheckCircle2, Clock, RotateCcw, ShieldAlert, Upload } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { ActionWithContext, PublishedContent } from "@/data/actions/types";
import type { AgentPendingAction } from "@/data/agents/types";
import {
  ACTION_PRIORITY_BADGE_VARIANT,
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_BADGE_VARIANT,
  ACTION_STATUS_LABEL,
  actionTypeLabel,
  autonomyLevelLabel,
} from "@/data/actions/labels";
import { isWithinRollbackWindow, rollbackDeadline } from "@/data/actions/rollback-window";
import { formatDateTime } from "@/lib/format";
import { ActionOrigin } from "./action-origin";

/**
 * One row in any of the Action Center's four sections. A single component,
 * not four near-duplicates — which button (if any) renders is driven
 * entirely by `action.status`, same "one component, many places" precedent
 * `pending-action-panel.tsx` (Epic 12) already sets. Level 4 is never
 * offered an Approve/Execute control here regardless of status — UI-layer
 * defense in depth mirroring `routes/action-details.ts`'s own unconditional
 * guard clause, not a substitute for it (the real block is server-side).
 */
export function ActionCard({
  action,
  agentRunId,
  agentPendingAction,
  canPublish,
  busy,
  publishedContent,
  onApprove,
  onExecute,
  onRollback,
}: {
  action: ActionWithContext;
  agentRunId?: string;
  /** The agent-originated pending action's own record (`title`/
   *  `description`), resolved by the same bounded scan `agentRunId` comes
   *  from (`agentRunIdsByPendingActionId`) — see `action-origin.tsx` for
   *  why this needs to be passed through rather than re-derived. */
  agentPendingAction?: AgentPendingAction;
  /** Whether the current session's role (`owner`/`admin`) is allowed to
   *  mutate this action — a UI hint only; the real gate is the server's own
   *  `publish_content` permission check, surfaced as a 403 if this hint is
   *  ever wrong or stale. */
  canPublish: boolean;
  busy: boolean;
  /** The full `published_content` record, when this session itself just
   *  executed/rolled back this action — see `actions-view.tsx`'s "Known
   *  limitations" comment for why this is session-local, not re-fetchable. */
  publishedContent?: PublishedContent;
  onApprove?: (action: ActionWithContext) => void;
  onExecute?: (action: ActionWithContext) => void;
  onRollback?: (action: ActionWithContext) => void;
}) {
  const isLevel4 = action.autonomyLevel >= 4;

  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[14px] font-medium text-foreground">{action.title}</p>
          <Badge variant={ACTION_STATUS_BADGE_VARIANT[action.status]} size="sm">
            {ACTION_STATUS_LABEL[action.status]}
          </Badge>
          <Badge variant={ACTION_PRIORITY_BADGE_VARIANT[action.priority]} size="sm">
            {ACTION_PRIORITY_LABEL[action.priority]}
          </Badge>
          <Badge variant="outline" size="sm">
            {actionTypeLabel(action.actionType)}
          </Badge>
        </div>
        {action.description && <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">{action.description}</p>}
        <p className="font-mono text-[10.5px] text-subtle-foreground mt-1.5">{autonomyLevelLabel(action.autonomyLevel)}</p>
      </div>

      <ActionOrigin action={action} agentRunId={agentRunId} agentPendingAction={agentPendingAction} />

      {isLevel4 && (
        <div className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 flex items-center gap-2">
          <ShieldAlert size={14} className="text-danger shrink-0" />
          <p className="text-[12px] text-danger">
            Level 4 (fully autonomous) actions are blocked — they can never be approved or executed, even against this exact row, server-side.
          </p>
        </div>
      )}

      {action.status === "pending" && !isLevel4 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="primary" size="sm" loading={busy} disabled={!canPublish} onClick={() => onApprove?.(action)}>
            <CheckCircle2 size={13} /> Approve
          </Button>
          <span className="text-[11.5px] text-subtle-foreground">
            {canPublish ? "Approving doesn't publish anything yet — execution is a separate step." : "Only an owner or admin can approve."}
          </span>
        </div>
      )}

      {action.status === "approved" && !isLevel4 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="primary" size="sm" loading={busy} disabled={!canPublish} onClick={() => onExecute?.(action)}>
            <Upload size={13} /> Execute — publish now
          </Button>
          <span className="text-[11.5px] text-subtle-foreground">
            {canPublish
              ? `Approved ${action.approvedAt ? formatDateTime(action.approvedAt) : ""} · writes an internal record only — no external CMS is connected yet.`
              : "Only an owner or admin can execute."}
          </span>
        </div>
      )}

      {(action.status === "completed" || action.status === "rolled_back") && (
        <Outcome action={action} publishedContent={publishedContent} canPublish={canPublish} busy={busy} onRollback={onRollback} />
      )}
    </div>
  );
}

function Outcome({
  action,
  publishedContent,
  canPublish,
  busy,
  onRollback,
}: {
  action: ActionWithContext;
  publishedContent?: PublishedContent;
  canPublish: boolean;
  busy: boolean;
  onRollback?: (action: ActionWithContext) => void;
}) {
  // `publishedContent` (full record) only exists when THIS session just
  // executed/rolled back the action; every other load falls back to
  // `action.result`'s summary pointer — the only outcome data `GET
  // /brands/me/actions` itself ever returns (there is no `GET
  // /published-content/:id` route to re-fetch the full record from).
  const destinationRef = publishedContent?.destinationRef ?? action.result?.destinationRef;
  const publishTarget = publishedContent?.publishTarget ?? "internal_record";
  const withinWindow = action.status === "completed" && !!action.executedAt && isWithinRollbackWindow(action.executedAt);
  const deadline = action.executedAt ? rollbackDeadline(action.executedAt) : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={action.status === "rolled_back" ? "neutral" : "success"} size="sm">
          {action.status === "rolled_back" ? "Reverted" : "Published"}
        </Badge>
        <span className="font-mono text-[10.5px] text-subtle-foreground">
          {publishTarget === "internal_record" ? "Internal record — no external CMS connected" : publishTarget}
        </span>
        {destinationRef && <span className="font-mono text-[10.5px] text-subtle-foreground truncate">{destinationRef}</span>}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {action.executedAt && `Executed ${formatDateTime(action.executedAt)}`}
        {action.rolledBackAt && ` · Rolled back ${formatDateTime(action.rolledBackAt)}`}
      </p>
      {action.status === "completed" &&
        (withinWindow ? (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <Button variant="danger" size="sm" loading={busy} disabled={!canPublish} onClick={() => onRollback?.(action)}>
              <RotateCcw size={13} /> Roll back
            </Button>
            <span className="text-[11.5px] text-subtle-foreground flex items-center gap-1">
              <Clock size={11} />
              {canPublish ? `Available until ${deadline ? formatDateTime(deadline.toISOString()) : ""}` : "Only an owner or admin can roll back."}
            </span>
          </div>
        ) : (
          <p className="text-[11.5px] text-subtle-foreground mt-1">The 30-day rollback window has expired.</p>
        ))}
    </div>
  );
}
