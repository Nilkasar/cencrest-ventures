"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bebest/ui";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import {
  ACTION_TYPE_BADGE_VARIANT,
  ACTION_TYPE_LABEL,
  EFFORT_BADGE_VARIANT,
  IMPACT_BADGE_VARIANT,
  LEVEL_LABEL,
  RECOMMENDATION_STATUS_LABEL,
  splitImplementationNotes,
} from "@/data/recommendations/labels";
import { EvidenceTrailPanel, useEvidenceTrail } from "@/components/opportunities/evidence-trail";
import { PendingActionPanel } from "@/components/agents/pending-action-panel";
import type { AgentPendingAction } from "@/data/agents/types";
import { formatDate } from "@/lib/format";

const STATUS_OPTIONS: RecommendationStatus[] = ["new", "in_progress", "completed", "dismissed"];

/**
 * One row on the standalone "top 10 prioritized recommendations" screen
 * (`docs/09-ux/CUSTOMER_JOURNEY.md`'s onboarding Step 6 + Stage 4 dashboard).
 * Fuller than the inline `NextActionPanel` on the Opportunities screen — this
 * IS the primary view for a recommendation, so it always shows the full
 * brief (description, evidence summary, both SEO+GEO requirement blocks) and
 * lazy-loads its source opportunity's full evidence trail on request
 * (`EvidenceTrailPanel`, the same component/fetch `opportunity-card.tsx`
 * uses — never a bare instruction with no backing, per this epic's UI
 * requirement).
 */
export function RecommendationCard({
  recommendation,
  updating,
  onStatusChange,
  pendingAction,
  onApprovePendingAction,
}: {
  recommendation: Recommendation;
  updating: boolean;
  onStatusChange: (recommendation: Recommendation, status: RecommendationStatus) => void;
  /** Epic 12's Level 3 one-click approval, joined in by
   *  `recommendations-view.tsx` via `listPendingActionsByRecommendationId`
   *  when an agent run proposed a content brief FROM this exact
   *  recommendation — `undefined` when no agent has proposed anything for
   *  it. Surfaced inline here rather than a separate approval inbox, per
   *  that epic's UI-surface requirement. */
  pendingAction?: AgentPendingAction;
  onApprovePendingAction?: () => Promise<void>;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const { state: evidenceState, load: loadEvidence } = useEvidenceTrail(recommendation.opportunityId);
  const notes = splitImplementationNotes(recommendation.implementationNotes);

  async function toggleEvidence() {
    const next = !showEvidence;
    setShowEvidence(next);
    if (next && evidenceState.status === "idle") {
      await loadEvidence();
    }
  }

  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-medium text-foreground">{recommendation.title}</p>
            <Badge variant={ACTION_TYPE_BADGE_VARIANT[recommendation.actionType]} size="sm">
              {ACTION_TYPE_LABEL[recommendation.actionType]}
            </Badge>
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-1">{recommendation.description}</p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">Effort</p>
            <Badge variant={EFFORT_BADGE_VARIANT[recommendation.effort]} size="sm">
              {LEVEL_LABEL[recommendation.effort]}
            </Badge>
          </div>
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">Impact</p>
            <Badge variant={IMPACT_BADGE_VARIANT[recommendation.impact]} size="sm">
              {LEVEL_LABEL[recommendation.impact]}
            </Badge>
          </div>
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">Priority</p>
            <p className="font-mono text-[20px] font-semibold text-accent">{recommendation.priorityRank}</p>
          </div>
        </div>
      </div>

      <p className="text-[12.5px] text-foreground leading-relaxed rounded-lg border border-border bg-surface px-3 py-2.5">
        {recommendation.evidenceSummary}
      </p>

      {pendingAction && onApprovePendingAction && (
        <PendingActionPanel pendingAction={pendingAction} onApprove={onApprovePendingAction} compact />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={recommendation.status} onValueChange={(v) => onStatusChange(recommendation, v as RecommendationStatus)} disabled={updating}>
          <SelectTrigger className="w-44 h-8 text-[12.5px]" aria-label={`Change status of "${recommendation.title}"`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {RECOMMENDATION_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {updating && <span className="text-[12px] text-muted-foreground">Saving…</span>}
        <button
          type="button"
          onClick={toggleEvidence}
          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline underline-offset-4"
        >
          {showEvidence ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showEvidence ? "Hide source evidence" : "View source evidence"}
        </button>
        <span className="text-[11px] text-subtle-foreground">Updated {formatDate(recommendation.updatedAt)}</span>
      </div>

      {showEvidence && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <EvidenceTrailPanel state={evidenceState} onRetry={loadEvidence} />
        </div>
      )}

      {notes && (
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-accent/25 bg-accent-muted/30 p-3">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">SEO requirements</p>
            <p className="text-[12.5px] text-foreground leading-relaxed">{notes.seo}</p>
          </div>
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">GEO requirements</p>
            <p className="text-[12.5px] text-foreground leading-relaxed">{notes.geo}</p>
          </div>
        </div>
      )}
    </div>
  );
}
