"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@bebest/ui";
import type { Opportunity, OpportunityStatus } from "@/data/opportunities/types";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import {
  OPPORTUNITY_STATUS_BADGE_VARIANT,
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_TYPE_BADGE_VARIANT,
  OPPORTUNITY_TYPE_LABEL,
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  effortTone,
  scoreTone,
} from "@/data/opportunities/labels";
import { EvidenceTrailPanel, useEvidenceTrail } from "./evidence-trail";
import { NextActionPanel } from "@/components/recommendations/next-action-panel";

const STATUS_OPTIONS: OpportunityStatus[] = ["new", "in_progress", "completed", "dismissed"];

const SCORE_TONE_CLASS: Record<ReturnType<typeof scoreTone>, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function ScoreTile({ label, value, tone }: { label: string; value: number | null; tone?: ReturnType<typeof scoreTone> }) {
  return (
    <div>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">{label}</p>
      <p className={`font-mono text-[15px] font-semibold ${tone ? SCORE_TONE_CLASS[tone] : "text-foreground"}`}>
        {value === null ? "—" : value}
      </p>
    </div>
  );
}

/**
 * One card in the Opportunities list — `docs/09-ux/CUSTOMER_JOURNEY.md`'s
 * "What should I do next?" screen. Per the epic's UI-surface requirement,
 * every card carries:
 *   - its score AND the evidence behind it, one click away (`GET
 *     /opportunities/:id` is lazy-fetched the first time the disclosure
 *     opens, then cached locally — the list response itself never inlines
 *     evidence, see `data/opportunities/types.ts`'s header comment);
 *   - a visible next action: a status control (New / In progress /
 *     Completed / Dismissed) that, for Dismissed specifically, requires a
 *     reason before committing (`PATCH` 422s without one);
 *   - Epic 10's generated recommendation as the opportunity's own "Next
 *     action" (`NextActionPanel`) — effort/impact visible, a link back into
 *     this same card's evidence disclosure (never a bare instruction with no
 *     backing, per that epic's UI requirement), and a status control of its
 *     own distinct from the opportunity's status above.
 */
export function OpportunityCard({
  opportunity,
  updating,
  onStatusChange,
  recommendation,
  recommendationLoading,
  generatingRecommendation,
  onGenerateRecommendation,
  updatingRecommendationStatus,
  onRecommendationStatusChange,
}: {
  opportunity: Opportunity;
  updating: boolean;
  onStatusChange: (opportunity: Opportunity, status: OpportunityStatus, dismissalReason?: string) => void;
  /** `undefined` when no recommendation has been generated for this
   *  opportunity yet — distinct from "still loading" (`recommendationLoading`). */
  recommendation: Recommendation | undefined;
  recommendationLoading: boolean;
  generatingRecommendation: boolean;
  onGenerateRecommendation: (opportunity: Opportunity) => void;
  updatingRecommendationStatus: boolean;
  onRecommendationStatusChange: (recommendation: Recommendation, status: RecommendationStatus) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const { state: evidenceState, load: loadEvidence } = useEvidenceTrail(opportunity.id);
  const [pendingDismiss, setPendingDismiss] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  async function toggleEvidence() {
    const next = !showEvidence;
    setShowEvidence(next);
    if (next && evidenceState.status === "idle") {
      await loadEvidence();
    }
  }

  function openEvidence() {
    if (!showEvidence) void toggleEvidence();
  }

  function handleStatusSelect(next: OpportunityStatus) {
    if (next === "dismissed") {
      setPendingDismiss(true);
      setReasonError(false);
      return;
    }
    setPendingDismiss(false);
    onStatusChange(opportunity, next);
  }

  function confirmDismiss() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(true);
      return;
    }
    onStatusChange(opportunity, "dismissed", trimmed);
    setPendingDismiss(false);
    setReason("");
  }

  const tone = scoreTone(opportunity.opportunityScore);

  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-medium text-foreground">{opportunity.title}</p>
            <Badge variant={OPPORTUNITY_TYPE_BADGE_VARIANT[opportunity.type]} size="sm">
              {OPPORTUNITY_TYPE_LABEL[opportunity.type]}
            </Badge>
            <Badge variant={OPPORTUNITY_STATUS_BADGE_VARIANT[opportunity.status]} size="sm">
              {OPPORTUNITY_STATUS_LABEL[opportunity.status]}
            </Badge>
            <Badge variant={PRIORITY_BADGE_VARIANT[opportunity.priority]} size="sm">
              {PRIORITY_LABEL[opportunity.priority]}
            </Badge>
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-1 truncate">Intent: “{opportunity.intentText}”</p>
          <button
            type="button"
            onClick={toggleEvidence}
            className="mt-2 inline-flex items-center gap-1 text-[12px] text-accent hover:underline underline-offset-4"
          >
            {showEvidence ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showEvidence ? "Hide evidence" : "Show evidence"}
          </button>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <ScoreTile label="SEO demand" value={opportunity.seoDemandScore} />
          <ScoreTile label="GEO gap" value={opportunity.geoGapScore} />
          <ScoreTile label="Effort" value={opportunity.effortScore} tone={effortTone(opportunity.effortScore)} />
          <ScoreTile label="Impact" value={opportunity.impactScore} tone={scoreTone(opportunity.impactScore)} />
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">Score</p>
            <p className={`font-mono text-[20px] font-semibold ${SCORE_TONE_CLASS[tone]}`}>{opportunity.opportunityScore}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={opportunity.status}
          onValueChange={(v) => handleStatusSelect(v as OpportunityStatus)}
          disabled={updating}
        >
          <SelectTrigger className="w-44 h-8 text-[12.5px]" aria-label={`Change status of "${opportunity.title}"`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {OPPORTUNITY_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {updating && <span className="text-[12px] text-muted-foreground">Saving…</span>}
        {!pendingDismiss && opportunity.status === "dismissed" && opportunity.dismissalReason && (
          <p className="text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Dismissed: </span>
            {opportunity.dismissalReason}
          </p>
        )}
      </div>

      {pendingDismiss && (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-muted p-3">
          <Textarea
            label="Why are you dismissing this opportunity?"
            placeholder="e.g. Already covered by an upcoming campaign"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(false);
            }}
            error={reasonError ? "A reason is required to dismiss an opportunity." : undefined}
            rows={2}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPendingDismiss(false);
                setReason("");
                setReasonError(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={updating} onClick={confirmDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {showEvidence && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <EvidenceTrailPanel state={evidenceState} onRetry={loadEvidence} />
        </div>
      )}

      <NextActionPanel
        recommendation={recommendation}
        loading={recommendationLoading}
        generating={generatingRecommendation}
        onGenerate={() => onGenerateRecommendation(opportunity)}
        updatingStatus={updatingRecommendationStatus}
        onStatusChange={(status) => recommendation && onRecommendationStatusChange(recommendation, status)}
        onViewEvidence={openEvidence}
      />
    </div>
  );
}
