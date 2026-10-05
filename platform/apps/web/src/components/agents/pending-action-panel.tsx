"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge, Button, cn } from "@bebest/ui";
import type { AgentPendingAction } from "@/data/agents/types";
import { PENDING_ACTION_STATUS_BADGE_VARIANT, PENDING_ACTION_STATUS_LABEL } from "@/data/agents/labels";
import { formatDate } from "@/lib/format";

/**
 * Level 3's one-click approval — `docs/epics/12-agents.md`'s literal UI
 * requirement: "surfaced inline wherever a pending action appears... rather
 * than building a separate approval inbox." Used on the live run detail
 * view, and inline on the recommendation row / opportunity card (via
 * `data/agents/client.ts`'s `listPendingActionsByRecommendationId` join),
 * so a customer never has to visit an agent run to act on what it proposed.
 *
 * Approving here only calls `POST /agent-runs/:id/approve` — it never
 * publishes or executes anything (Epic 13's job); the copy says so.
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
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3.5 sm:flex-row sm:items-center sm:justify-between",
        isPending ? "border-warning/35 bg-warning-muted/50" : "border-border bg-surface/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            isPending ? "bg-warning-muted text-warning" : "bg-surface text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <ShieldCheck size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-medium text-foreground">{pendingAction.title}</p>
            <Badge variant={PENDING_ACTION_STATUS_BADGE_VARIANT[pendingAction.status]} size="sm" dot>
              {PENDING_ACTION_STATUS_LABEL[pendingAction.status]}
            </Badge>
          </div>
          {!compact && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{pendingAction.description}</p>}
          <p className="mt-1 text-[12px] text-muted-foreground">
            {isPending
              ? "Proposed by an agent at Level 3. Approving starts a 30-day rollback window and never publishes anything on its own."
              : pendingAction.approvedAt
                ? `Approved ${formatDate(pendingAction.approvedAt)}${pendingAction.rollbackUntil ? ` · rollback available until ${formatDate(pendingAction.rollbackUntil)}` : ""}`
                : "Agent action"}
          </p>
        </div>
      </div>

      {isPending ? (
        <Button variant="primary" size="sm" loading={approving} onClick={handleApprove} className="shrink-0 self-start sm:self-center">
          <CheckCircle2 size={14} aria-hidden="true" /> Approve
        </Button>
      ) : (
        pendingAction.approvedAt && (
          <Button variant="ghost" size="sm" asChild className="shrink-0 self-start sm:self-center">
            <Link href="/actions">
              View in Actions <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </Button>
        )
      )}
    </div>
  );
}
