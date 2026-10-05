"use client";

import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, useToast } from "@bebest/ui";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import { ACTION_TYPE_BADGE_VARIANT, ACTION_TYPE_LABEL, RECOMMENDATION_STATUS_LABEL, splitImplementationNotes } from "@/data/recommendations/labels";
import { DisclosureButton, LevelMeter, RequirementsGrid } from "./level-meter";
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong/60 bg-surface/60 px-3.5 py-3">
        <p className="text-[12.5px] text-muted-foreground">No next action generated for this opportunity yet.</p>
        <Button variant="outline" size="sm" loading={generating} onClick={onGenerate}>
          <Sparkles size={13} aria-hidden="true" /> Generate recommendation
        </Button>
      </div>
    );
  }

  const notes = splitImplementationNotes(recommendation.implementationNotes);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-3.5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Next action</p>
          <p className="text-[13.5px] font-medium text-foreground">{recommendation.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <Badge variant={ACTION_TYPE_BADGE_VARIANT[recommendation.actionType]} size="sm">
              {ACTION_TYPE_LABEL[recommendation.actionType]}
            </Badge>
            <LevelMeter label="Impact" level={recommendation.impact} />
            <LevelMeter label="Effort" level={recommendation.effort} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {updatingStatus && (
            <span className="text-[12px] text-muted-foreground" aria-live="polite">
              Saving…
            </span>
          )}
          <Select value={recommendation.status} onValueChange={(v) => onStatusChange(v as RecommendationStatus)} disabled={updatingStatus}>
            <SelectTrigger className="h-8 w-[136px] text-[12.5px]" aria-label={`Status of recommendation "${recommendation.title}"`}>
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

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{recommendation.evidenceSummary}</p>

      {pendingAction && onApprovePendingAction && (
        <PendingActionPanel pendingAction={pendingAction} onApprove={onApprovePendingAction} compact />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DisclosureButton expanded={showNotes} onClick={() => setShowNotes((v) => !v)}>
          Implementation brief
        </DisclosureButton>
        <Button variant="link" size="sm" onClick={onViewEvidence} className="text-[12.5px]">
          View evidence
        </Button>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button variant="ghost" size="sm" loading={generating} onClick={onGenerate}>
            Regenerate
          </Button>
          {isContentTypeAction(recommendation.actionType) && (
            <Button variant="secondary" size="sm" loading={generatingBrief} onClick={handleGenerateContentBrief}>
              <FileText size={13} aria-hidden="true" /> Generate content brief
            </Button>
          )}
        </div>
      </div>

      {showNotes &&
        (notes ? (
          <RequirementsGrid seo={notes.seo} geo={notes.geo} />
        ) : (
          <p className="whitespace-pre-line rounded-lg border border-border bg-surface-raised p-3 text-[12.5px] leading-relaxed text-foreground">
            {recommendation.implementationNotes}
          </p>
        ))}
    </div>
  );
}
