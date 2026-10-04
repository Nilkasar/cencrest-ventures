"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn } from "@bebest/ui";
import type { Opportunity, OpportunityStatus } from "@/data/opportunities/types";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import type { AgentPendingAction } from "@/data/agents/types";
import { OPPORTUNITY_STATUS_LABEL, scoreTone } from "@/data/opportunities/labels";
import { EvidenceTrailPanel, useEvidenceTrail } from "./evidence-trail";
import { NextActionPanel } from "@/components/recommendations/next-action-panel";
import { OpportunityStatusBadge, OpportunityTypeBadge, PriorityBadge, QuickWinBadge, ScoreMeter, isQuickWin } from "./status-badges";

const STATUS_OPTIONS: OpportunityStatus[] = ["new", "in_progress", "completed", "dismissed"];

const SCORE_TONE_CLASS: Record<ReturnType<typeof scoreTone>, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * One opportunity in the ranked list (an `<li>`) — "What should I do
 * next?" Read left to right: the score and rank, what the opportunity is
 * (with its badges and the real intent behind it), and the four numbers
 * the score is built from. Below it: the status control, the evidence
 * trail (lazy `GET /opportunities/:id` on first open), and Epic 10's
 * generated next action. Dismissing requires a reason (`PATCH` 422s
 * without one).
 */
export function OpportunityCard({
  opportunity,
  rank,
  updating,
  onStatusChange,
  recommendation,
  recommendationLoading,
  generatingRecommendation,
  onGenerateRecommendation,
  updatingRecommendationStatus,
  onRecommendationStatusChange,
  pendingAction,
  onApprovePendingAction,
}: {
  opportunity: Opportunity;
  rank: number;
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
  /** Epic 12's Level 3 one-click approval for this opportunity's
   *  recommendation, if any agent run has proposed one. */
  pendingAction?: AgentPendingAction;
  onApprovePendingAction?: () => Promise<void>;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const { state: evidenceState, load: loadEvidence } = useEvidenceTrail(opportunity.id);
  const [pendingDismiss, setPendingDismiss] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const evidenceId = useId();


  async function toggleEvidence() {
    const next = !showEvidence;
    setShowEvidence(next);
    if (next && evidenceState.status === "idle") {
      await loadEvidence();
    }
  }

  function openEvidence() {
    if (!showEvidence) void toggleEvidence();
    requestAnimationFrame(() => document.getElementById(evidenceId)?.scrollIntoView({ block: "nearest" }));
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
  const dismissed = opportunity.status === "dismissed";
  const quickWin = !dismissed && opportunity.status !== "completed" && isQuickWin(opportunity);

  return (
    <li className={cn("flex flex-col gap-3 px-5 py-4", dismissed && "bg-surface/40")}>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 md:grid-cols-[3.5rem_minmax(0,1fr)_15rem]">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span
            className={cn(
              "font-mono text-[22px] font-semibold leading-none tabular-nums",
              dismissed ? "text-muted-foreground" : SCORE_TONE_CLASS[tone],
            )}
          >
            {Math.round(opportunity.opportunityScore)}
          </span>
          <span className="font-mono text-[10px] text-subtle-foreground">#{rank}</span>
          <span className="sr-only">
            Opportunity score {Math.round(opportunity.opportunityScore)} of 100, ranked {rank}
          </span>
        </div>

        <div className="min-w-0">
          <h3 className={cn("text-[14px] font-medium leading-snug", dismissed ? "text-muted-foreground" : "text-foreground")}>
            {opportunity.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {quickWin && <QuickWinBadge />}
            <OpportunityStatusBadge status={opportunity.status} />
            <PriorityBadge priority={opportunity.priority} />
            <OpportunityTypeBadge type={opportunity.type} />
          </div>
          <p className="mt-1.5 truncate text-[12.5px] text-muted-foreground" title={opportunity.intentText}>
            Intent: &ldquo;{opportunity.intentText}&rdquo;
          </p>
        </div>

        <dl className="col-span-2 grid grid-cols-2 gap-x-5 gap-y-2 sm:pl-[4.5rem] md:col-span-1 md:grid-cols-1 md:gap-y-1.5 md:pl-0 md:pt-0.5">
          <Factor label="Impact" value={opportunity.impactScore} fill="bg-foreground/70" hint="higher is better" delay={0.1} />
          <Factor label="Effort" value={opportunity.effortScore} fill="bg-subtle-foreground" hint="lower is better" delay={0.14} />
          <Factor label="SEO demand" value={opportunity.seoDemandScore} fill="bg-foreground/45" hint="search demand signal" delay={0.18} />
          <Factor label="GEO gap" value={opportunity.geoGapScore} fill="bg-foreground/45" hint="AI-visibility gap signal" delay={0.22} />
        </dl>
      </div>

      <div className="flex flex-col gap-3 sm:pl-[4.5rem]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Select value={opportunity.status} onValueChange={(v) => handleStatusSelect(v as OpportunityStatus)} disabled={updating}>
            <SelectTrigger className="h-8 w-40 text-[12.5px]" aria-label={`Status of "${opportunity.title}"`}>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleEvidence()}
            aria-expanded={showEvidence}
            aria-controls={evidenceId}
            className="text-accent hover:text-accent"
          >
            <ChevronRight size={13} className={cn("transition-transform duration-200 motion-reduce:transition-none", showEvidence && "rotate-90")} aria-hidden="true" />
            Evidence
          </Button>
          {updating && (
            <span className="text-[12px] text-muted-foreground" role="status">
              Saving…
            </span>
          )}
          {!pendingDismiss && dismissed && opportunity.dismissalReason && (
            <p className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">Dismissed: </span>
              {opportunity.dismissalReason}
            </p>
          )}
        </div>

        {pendingDismiss && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <Textarea
              label="Why are you dismissing this opportunity?"
              placeholder="e.g. Already covered by an upcoming campaign"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(false);
              }}
              error={reasonError ? "Add a reason so this doesn't come back without context." : undefined}
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
                Dismiss opportunity
              </Button>
            </div>
          </div>
        )}

        {showEvidence && (
          <div id={evidenceId} className="rounded-lg border border-border bg-surface/60 p-3.5">
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
          pendingAction={pendingAction}
          onApprovePendingAction={onApprovePendingAction}
        />
      </div>
    </li>
  );
}

function Factor({ label, value, fill, hint, delay }: { label: string; value: number | null; fill: string; hint: string; delay: number }) {
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_2rem] items-center gap-2">
      <dt className="truncate text-[11.5px] text-muted-foreground">
        {label}
        <span className="sr-only"> ({hint})</span>
      </dt>
      <ScoreMeter value={value} fillClassName={fill} delay={delay} />
      <dd className={cn("text-right font-mono text-[12px] tabular-nums", value === null ? "text-subtle-foreground" : "text-foreground")}>
        {value === null ? "—" : Math.round(value)}
      </dd>
    </div>
  );
}
