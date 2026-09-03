"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Sparkles } from "lucide-react";
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, useToast } from "@bebest/ui";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import {
  ACTION_TYPE_BADGE_VARIANT,
  ACTION_TYPE_LABEL,
  EFFORT_BADGE_VARIANT,
  IMPACT_BADGE_VARIANT,
  LEVEL_LABEL,
  RECOMMENDATION_STATUS_BADGE_VARIANT,
  RECOMMENDATION_STATUS_LABEL,
  splitImplementationNotes,
} from "@/data/recommendations/labels";
import { generateContentBrief } from "@/data/content/client";
import { PendingActionPanel } from "@/components/agents/pending-action-panel";
import type { AgentPendingAction } from "@/data/agents/types";

const STATUS_OPTIONS: RecommendationStatus[] = ["new", "in_progress", "completed", "dismissed"];

/** Epic 11's entry point: a content brief is generated FROM an approved,
 *  content-type recommendation (`create_page`/`update_page` — the two
 *  action types that actually produce written content, per
 *  `apps/api/src/lib/content/brief-builder.ts`'s `isContentTypeRecommendation`).
 *  Kept as a client-side mirror of that same distinction rather than a
 *  second server round trip just to ask "can I brief this?" — the server
 *  re-checks (409/422) regardless, this only decides whether the button
 *  renders at all. */
function isContentTypeAction(actionType: Recommendation["actionType"]): boolean {
  return actionType === "create_page" || actionType === "update_page";
}

/**
 * Epic 10 (Recommendation Engine)'s "next action" — inline on Epic 9's
 * Opportunities screen (`opportunity-card.tsx`), per the epic's UI-surface
 * requirement. Extends that card rather than duplicating it: this panel
 * owns only the recommendation's own concerns (action type, effort/impact,
 * priority, status, the dual SEO+GEO implementation brief); the "link to
 * its source opportunity's evidence" requirement is satisfied by asking the
 * card to open its ALREADY-BUILT evidence disclosure (`onViewEvidence`)
 * rather than fetching a second copy of the same trail.
 */
export function NextActionPanel({
  recommendation,
  loading,
  generating,
  onGenerate,
  updatingStatus,
  onStatusChange,
  onViewEvidence,
  pendingAction,
  onApprovePendingAction,
}: {
  recommendation: Recommendation | undefined;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  updatingStatus: boolean;
  onStatusChange: (status: RecommendationStatus) => void;
  onViewEvidence: () => void;
  /** Epic 12's Level 3 one-click approval for the agent action (if any)
   *  proposed FROM this opportunity's recommendation — see
   *  `recommendation-card.tsx`'s identical prop for the full rationale.
   *  `undefined` when no agent has proposed anything for it. */
  pendingAction?: AgentPendingAction;
  onApprovePendingAction?: () => Promise<void>;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const { toast } = useToast();

  async function handleGenerateContentBrief() {
    if (!recommendation) return;
    setGeneratingBrief(true);
    try {
      const { created } = await generateContentBrief(recommendation.id);
      toast({
        title: created ? "Content brief generated" : "Content brief refreshed",
        description: "Carries forward this recommendation's full SEO+GEO requirements. Review it on the Content screen.",
      });
    } catch (err) {
      toast({
        title: "Couldn't generate a content brief",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setGeneratingBrief(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-9 w-full rounded-lg" />;
  }

  if (!recommendation) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-dashed border-border bg-surface px-3 py-2.5">
        <p className="text-[12.5px] text-muted-foreground">No next action generated yet for this opportunity.</p>
        <Button variant="outline" size="sm" loading={generating} onClick={onGenerate}>
          <Sparkles size={13} /> Generate recommendation
        </Button>
      </div>
    );
  }

  const notes = splitImplementationNotes(recommendation.implementationNotes);

  return (
    <div className="rounded-lg border border-accent/25 bg-accent-muted/40 p-3 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">Next action</p>
          <p className="text-[13px] font-medium text-foreground">{recommendation.title}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          <Badge variant={ACTION_TYPE_BADGE_VARIANT[recommendation.actionType]} size="sm">
            {ACTION_TYPE_LABEL[recommendation.actionType]}
          </Badge>
          <Badge variant={EFFORT_BADGE_VARIANT[recommendation.effort]} size="sm">
            {LEVEL_LABEL[recommendation.effort]} effort
          </Badge>
          <Badge variant={IMPACT_BADGE_VARIANT[recommendation.impact]} size="sm">
            {LEVEL_LABEL[recommendation.impact]} impact
          </Badge>
          <Badge variant={RECOMMENDATION_STATUS_BADGE_VARIANT[recommendation.status]} size="sm">
            {RECOMMENDATION_STATUS_LABEL[recommendation.status]}
          </Badge>
        </div>
      </div>

      <p className="text-[12.5px] text-muted-foreground leading-relaxed">{recommendation.evidenceSummary}</p>

      {pendingAction && onApprovePendingAction && (
        <PendingActionPanel pendingAction={pendingAction} onApprove={onApprovePendingAction} compact />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={recommendation.status}
          onValueChange={(v) => onStatusChange(v as RecommendationStatus)}
          disabled={updatingStatus}
        >
          <SelectTrigger className="w-40 h-7 text-[12px]" aria-label={`Change status of recommendation "${recommendation.title}"`}>
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
        {updatingStatus && <span className="text-[11.5px] text-muted-foreground">Saving…</span>}
        <button
          type="button"
          onClick={onViewEvidence}
          className="text-[12px] text-accent hover:underline underline-offset-4"
        >
          View evidence
        </button>
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline underline-offset-4"
        >
          {showNotes ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showNotes ? "Hide implementation brief" : "Show implementation brief"}
        </button>
        <Button variant="ghost" size="sm" loading={generating} onClick={onGenerate}>
          Regenerate
        </Button>
        {isContentTypeAction(recommendation.actionType) && (
          <Button variant="outline" size="sm" loading={generatingBrief} onClick={handleGenerateContentBrief}>
            <FileText size={13} /> Generate content brief
          </Button>
        )}
      </div>

      {showNotes && (
        <div className="rounded-lg border border-border bg-surface p-3">
          {notes ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">
                  SEO requirements
                </p>
                <p className="text-[12px] text-foreground leading-relaxed">{notes.seo}</p>
              </div>
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">
                  GEO requirements
                </p>
                <p className="text-[12px] text-foreground leading-relaxed">{notes.geo}</p>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line">
              {recommendation.implementationNotes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
