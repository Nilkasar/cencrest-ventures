"use client";

import { useId, useState } from "react";
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bebest/ui";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import { ACTION_TYPE_LABEL, RECOMMENDATION_STATUS_LABEL, splitImplementationNotes } from "@/data/recommendations/labels";
import { EvidenceTrailPanel, useEvidenceTrail } from "@/components/opportunities/evidence-trail";
import { PendingActionPanel } from "@/components/agents/pending-action-panel";
import type { AgentPendingAction } from "@/data/agents/types";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { DisclosureButton, LevelMeter, RequirementsGrid } from "./level-meter";

const STATUS_OPTIONS: RecommendationStatus[] = ["new", "in_progress", "completed", "dismissed"];

/**
 * One row on the Recommendations list — `docs/09-ux/CUSTOMER_JOURNEY.md`'s
 * "top 10 prioritized recommendations". Read top-down in the order a
 * person decides: what to do (title, type), whether it's worth it (impact
 * vs effort), why (the evidence summary, always visible — a recommendation
 * is never a bare instruction), then the status control on the right.
 * The SEO + GEO brief and the source opportunity's full evidence trail sit
 * one click away so the list stays scannable.
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
  /** Epic 12's Level 3 one-click approval for an agent action proposed
   *  FROM this exact recommendation (joined in by `recommendations-view`).
   *  `undefined` when no agent has proposed anything for it. */
  pendingAction?: AgentPendingAction;
  onApprovePendingAction?: () => Promise<void>;
}) {
  const [showBrief, setShowBrief] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const { state: evidenceState, load: loadEvidence } = useEvidenceTrail(recommendation.opportunityId);
  const notes = splitImplementationNotes(recommendation.implementationNotes);
  const briefId = useId();
  const dimmed = recommendation.status === "dismissed" || recommendation.status === "completed";

  async function toggleEvidence() {
    const next = !showEvidence;
    setShowEvidence(next);
    if (next && evidenceState.status === "idle") await loadEvidence();
  }

  return (
    <article className="flex gap-4 px-5 py-4" aria-labelledby={`${briefId}-title`}>
      <div
        className="hidden size-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-surface sm:flex"
        title="Priority rank — higher ranks are surfaced first"
      >
        <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-subtle-foreground">Rank</span>
        <span className="font-mono text-[14px] font-semibold leading-none tabular-nums text-foreground">{recommendation.priorityRank}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3
              id={`${briefId}-title`}
              className={dimmed ? "text-[14px] font-medium text-muted-foreground" : "text-[14px] font-medium text-foreground"}
            >
              {recommendation.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
              <Badge variant="outline" size="sm">
                {ACTION_TYPE_LABEL[recommendation.actionType]}
              </Badge>
              <LevelMeter label="Impact" level={recommendation.impact} />
              <LevelMeter label="Effort" level={recommendation.effort} />
              <span className="font-mono text-[11px] text-subtle-foreground sm:hidden">Rank {recommendation.priorityRank}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {updating && (
              <span className="text-[12px] text-muted-foreground" aria-live="polite">
                Saving…
              </span>
            )}
            <Select value={recommendation.status} onValueChange={(v) => onStatusChange(recommendation, v as RecommendationStatus)} disabled={updating}>
              <SelectTrigger className="h-8 w-[136px] text-[12.5px]" aria-label={`Status of "${recommendation.title}"`}>
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
          </div>
        </div>

        {recommendation.description && <p className="text-[13px] leading-relaxed text-muted-foreground">{recommendation.description}</p>}

        <blockquote className="border-l-2 border-border-strong pl-3 text-[13px] leading-relaxed text-foreground">
          <span className="sr-only">Evidence: </span>
          {recommendation.evidenceSummary}
        </blockquote>

        {pendingAction && onApprovePendingAction && <PendingActionPanel pendingAction={pendingAction} onApprove={onApprovePendingAction} compact />}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DisclosureButton expanded={showBrief} onClick={() => setShowBrief((v) => !v)} controls={`${briefId}-brief`}>
            Implementation brief
          </DisclosureButton>
          <DisclosureButton expanded={showEvidence} onClick={toggleEvidence} controls={`${briefId}-evidence`}>
            Source evidence
          </DisclosureButton>
          <span className="ml-auto text-[12px] text-subtle-foreground" title={formatDateTime(recommendation.updatedAt)}>
            Updated {formatRelativeTime(recommendation.updatedAt)}
          </span>
        </div>

        {showBrief && (
          <div id={`${briefId}-brief`}>
            {notes ? (
              <RequirementsGrid seo={notes.seo} geo={notes.geo} />
            ) : (
              <p className="whitespace-pre-line rounded-lg border border-border bg-surface/60 p-4 text-[13px] leading-relaxed text-foreground">
                {recommendation.implementationNotes}
              </p>
            )}
          </div>
        )}

        {showEvidence && (
          <div id={`${briefId}-evidence`} className="rounded-lg border border-border bg-surface/60 p-4">
            <EvidenceTrailPanel state={evidenceState} onRetry={loadEvidence} />
          </div>
        )}
      </div>
    </article>
  );
}
