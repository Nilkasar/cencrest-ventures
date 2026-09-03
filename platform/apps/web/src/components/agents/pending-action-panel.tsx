"use client";

import { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { AgentPendingAction } from "@/data/agents/types";
import { PENDING_ACTION_STATUS_BADGE_VARIANT, PENDING_ACTION_STATUS_LABEL } from "@/data/agents/labels";
import { formatDate } from "@/lib/format";

/**
 * Level 3's one-click approval — `docs/epics/12-agents.md`'s literal UI
 * requirement: "surfaced inline wherever a pending action appears... rather
 * than building a separate approval inbox." Used both on the live run
 * detail view (`agent-run-detail-view.tsx`, where it's unambiguous which run
 * it belongs to) and inline on `recommendation-card.tsx`/`opportunity-card.tsx`
 * (via `data/agents/client.ts`'s `listPendingActionsByRecommendationId`
 * join), so a customer never has to visit an agent run to act on what it
 * proposed.
 *
 * Approving here only calls `POST /agent-runs/:id/approve` — it never
 * publishes or executes anything (Epic 13's job); the copy below says so
 * explicitly rather than implying the recommendation goes live.
 */
export function PendingActionPanel({
  pendingAction,
  onApprove,
  compact = false,
}: {
  pendingAction: AgentPendingAction;
  onApprove: () => Promise<void>;
  compact?: boolean;
}) {
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  }

  const isPending = pendingAction.status === "pending";

  return (
    <div
      className={
        isPending
          ? "rounded-lg border border-warning/30 bg-warning-muted/40 p-3 flex flex-col gap-2"
          : "rounded-lg border border-border bg-surface p-3 flex flex-col gap-2"
      }
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1 flex items-center gap-1.5">
            <ShieldCheck size={11} /> Level 3 · Agent action
          </p>
          <p className="text-[13px] font-medium text-foreground">{pendingAction.title}</p>
        </div>
        <Badge variant={PENDING_ACTION_STATUS_BADGE_VARIANT[pendingAction.status]} size="sm">
          {PENDING_ACTION_STATUS_LABEL[pendingAction.status]}
        </Badge>
      </div>

      {!compact && <p className="text-[12.5px] text-muted-foreground leading-relaxed">{pendingAction.description}</p>}

      {isPending ? (
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" loading={approving} onClick={handleApprove}>
            <CheckCircle2 size={13} /> Approve
          </Button>
          <span className="text-[11.5px] text-subtle-foreground">
            Approving starts a 30-day rollback window. This never publishes anything on its own.
          </span>
        </div>
      ) : (
        pendingAction.approvedAt && (
          <p className="text-[11.5px] text-subtle-foreground">
            Approved {formatDate(pendingAction.approvedAt)}
            {pendingAction.rollbackUntil ? ` · rollback available until ${formatDate(pendingAction.rollbackUntil)}` : ""}
          </p>
        )
      )}
    </div>
  );
}
