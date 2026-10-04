"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Clock, Clock3, ExternalLink, RotateCcw, ShieldAlert, Upload } from "lucide-react";
import { Badge, Button, cn } from "@bebest/ui";
import type { ActionStatus, ActionWithContext, PublishedContent } from "@/data/actions/types";
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
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { ActionOrigin } from "./action-origin";
import { MeasurementPanel } from "./measurement-panel";

const STATUS_ICON: Record<ActionStatus, typeof Clock3> = {
  pending: Clock3,
  approved: Upload,
  completed: CheckCircle2,
  rolled_back: RotateCcw,
};

const STATUS_TILE: Record<ActionStatus, string> = {
  pending: "bg-warning-muted text-warning",
  approved: "bg-info-muted text-info",
  completed: "bg-success-muted text-success",
  rolled_back: "bg-surface text-muted-foreground",
};

/**
 * One action in the Action Center. A single component for all four
 * sections — which control renders (Approve / Execute / Roll back) is
 * driven entirely by `action.status`, and it sits top-right so the one
 * thing to do with this row is where the eye lands after the title.
 * Level 4 is never offered an Approve/Execute control regardless of
 * status — UI-layer defense in depth mirroring the server's own guard.
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
  /** The agent-originated pending action's own record, resolved by the
   *  same bounded scan `agentRunId` comes from. */
  agentPendingAction?: AgentPendingAction;
  /** Whether this session's role (`owner`/`admin`) may mutate — a UI hint
   *  only; the server's own permission check is the real gate. */
  canPublish: boolean;
  busy: boolean;
  /** The full `published_content` record, when this session itself just
   *  executed/rolled back this action (not re-fetchable). */
  publishedContent?: PublishedContent;
  onApprove?: (action: ActionWithContext) => void;
  onExecute?: (action: ActionWithContext) => void;
  onRollback?: (action: ActionWithContext) => void;
}) {
  const isLevel4 = action.autonomyLevel >= 4;
  const Icon = STATUS_ICON[action.status];
  const withinWindow = action.status === "completed" && !!action.executedAt && isWithinRollbackWindow(action.executedAt);
  const deadline = action.executedAt ? rollbackDeadline(action.executedAt) : null;
  const ownerOnly = "Only an owner or admin can do this.";

  let primary: ReactNode = null;
  let primaryHint: string | null = null;
  if (!isLevel4 && action.status === "pending" && onApprove) {
    primary = (
      <Button variant="primary" size="sm" loading={busy} disabled={!canPublish} onClick={() => onApprove(action)}>
        <CheckCircle2 size={14} aria-hidden="true" /> Approve
      </Button>
    );
    primaryHint = canPublish ? "Approving doesn't publish — executing is a separate step." : ownerOnly;
  } else if (!isLevel4 && action.status === "approved" && onExecute) {
    primary = (
      <Button variant="primary" size="sm" loading={busy} disabled={!canPublish} onClick={() => onExecute(action)}>
        <Upload size={14} aria-hidden="true" /> Execute
      </Button>
    );
    primaryHint = canPublish ? "Writes an internal publish record — no external CMS is connected yet." : ownerOnly;
  } else if (action.status === "completed" && withinWindow && onRollback) {
    primary = (
      <Button variant="outline" size="sm" loading={busy} disabled={!canPublish} onClick={() => onRollback(action)}>
        <RotateCcw size={14} aria-hidden="true" /> Roll back
      </Button>
    );
    primaryHint = canPublish && deadline ? `Rollback available until ${formatDate(deadline.toISOString())}.` : canPublish ? null : ownerOnly;
  }

  const lastEvent =
    action.rolledBackAt ? `Rolled back ${formatRelativeTime(action.rolledBackAt)}`
    : action.executedAt ? `Published ${formatRelativeTime(action.executedAt)}`
    : action.approvedAt ? `Approved ${formatRelativeTime(action.approvedAt)}`
    : `Created ${formatRelativeTime(action.createdAt)}`;

  return (
    <article className="flex gap-4 px-5 py-4">
      <span className={cn("hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex", STATUS_TILE[action.status])} aria-hidden="true">
        <Icon size={16} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-[14px] font-medium text-foreground">{action.title}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant={ACTION_STATUS_BADGE_VARIANT[action.status]} size="sm" dot>
                {ACTION_STATUS_LABEL[action.status]}
              </Badge>
              <Badge variant={ACTION_PRIORITY_BADGE_VARIANT[action.priority]} size="sm">
                {ACTION_PRIORITY_LABEL[action.priority]}
              </Badge>
              <Badge variant="outline" size="sm">
                {actionTypeLabel(action.actionType)}
              </Badge>
              <span className="ml-1 text-[12px] text-muted-foreground">
                {autonomyLevelLabel(action.autonomyLevel)} · <span title={formatDateTime(action.updatedAt)}>{lastEvent}</span>
              </span>
            </div>
          </div>
          {primary && (
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              {primary}
              {primaryHint && <p className="max-w-[260px] text-[11.5px] leading-snug text-muted-foreground sm:text-right">{primaryHint}</p>}
            </div>
          )}
        </div>

        {action.description && <p className="text-[13px] leading-relaxed text-muted-foreground">{action.description}</p>}

        {isLevel4 && (
          <div role="note" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2">
            <ShieldAlert size={14} className="shrink-0 text-danger" aria-hidden="true" />
            <p className="text-[12.5px] text-foreground">
              Level 4 (fully autonomous) actions are blocked — they can never be approved or executed, enforced server-side.
            </p>
          </div>
        )}

        <ActionOrigin action={action} agentRunId={agentRunId} agentPendingAction={agentPendingAction} />

        {(action.status === "completed" || action.status === "rolled_back") && (
          <>
            <Outcome action={action} publishedContent={publishedContent} withinWindow={withinWindow} />
            {/* Epic 14 — the before/after delta this action produced, with
               attribution confidence visibly labeled. Shown for a
               rolled-back action too: rollback reverts the publish record,
               not any measurement already taken while it was live. */}
            <MeasurementPanel action={action} />
          </>
        )}
      </div>
    </article>
  );
}

function Outcome({
  action,
  publishedContent,
  withinWindow,
}: {
  action: ActionWithContext;
  publishedContent?: PublishedContent;
  withinWindow: boolean;
}) {
  // `publishedContent` (full record) only exists when THIS session just
  // executed/rolled back the action; otherwise `action.result`'s summary
  // pointer is the only outcome data `GET /brands/me/actions` returns.
  const destinationRef = publishedContent?.destinationRef ?? action.result?.destinationRef;
  const publishTarget = publishedContent?.publishTarget ?? "internal_record";
  const reverted = action.status === "rolled_back";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/60 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge variant={reverted ? "neutral" : "success"} size="sm" dot>
          {reverted ? "Reverted" : "Published"}
        </Badge>
        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
          <ExternalLink size={11} aria-hidden="true" />
          {publishTarget === "internal_record" ? "Internal record (no external CMS connected)" : publishTarget}
        </span>
      </div>
      {destinationRef && <p className="break-all font-mono text-[11.5px] text-muted-foreground">{destinationRef}</p>}
      <p className="text-[12px] text-muted-foreground">
        {action.executedAt && `Executed ${formatDateTime(action.executedAt)}`}
        {action.rolledBackAt && ` · Rolled back ${formatDateTime(action.rolledBackAt)}`}
      </p>
      {action.status === "completed" && !withinWindow && (
        <p className="inline-flex items-center gap-1 text-[12px] text-subtle-foreground">
          <Clock size={11} aria-hidden="true" /> The 30-day rollback window has closed.
        </p>
      )}
    </div>
  );
}
