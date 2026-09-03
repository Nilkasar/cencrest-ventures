"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileWarning } from "lucide-react";
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Textarea } from "@bebest/ui";
import { getOpportunity } from "@/data/opportunities/client";
import type { Opportunity, OpportunityDetail, OpportunityStatus } from "@/data/opportunities/types";
import {
  OPPORTUNITY_STATUS_BADGE_VARIANT,
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_TYPE_BADGE_VARIANT,
  OPPORTUNITY_TYPE_LABEL,
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  effortTone,
  scoreTone,
  sourceTableLabel,
} from "@/data/opportunities/labels";
import { formatDate } from "@/lib/format";

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

type EvidenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: OpportunityDetail };

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
 *     reason before committing (`PATCH` 422s without one) — content-brief
 *     generation is Epic 10/11, out of scope here, so "dismiss with a
 *     reason" is this screen's one real terminal action today.
 */
export function OpportunityCard({
  opportunity,
  updating,
  onStatusChange,
}: {
  opportunity: Opportunity;
  updating: boolean;
  onStatusChange: (opportunity: Opportunity, status: OpportunityStatus, dismissalReason?: string) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>({ status: "idle" });
  const [pendingDismiss, setPendingDismiss] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  async function toggleEvidence() {
    const next = !showEvidence;
    setShowEvidence(next);
    if (next && evidenceState.status === "idle") {
      setEvidenceState({ status: "loading" });
      try {
        const detail = await getOpportunity(opportunity.id);
        setEvidenceState({ status: "success", data: detail });
      } catch (err) {
        setEvidenceState({ status: "error", error: err instanceof Error ? err : new Error("Couldn't load evidence.") });
      }
    }
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
          {evidenceState.status === "loading" && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          )}
          {evidenceState.status === "error" && (
            <div className="flex items-center gap-2 text-[12.5px] text-danger">
              <FileWarning size={14} className="shrink-0" />
              {evidenceState.error.message}
              <Button variant="ghost" size="sm" onClick={toggleEvidence}>
                Retry
              </Button>
            </div>
          )}
          {evidenceState.status === "success" && (
            <ul className="flex flex-col gap-2.5">
              {evidenceState.data.evidence.map((row) => (
                <li key={row.id} className="text-[12.5px] leading-relaxed">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mr-2">
                    {sourceTableLabel(row.sourceTable)}
                  </span>
                  <span className="text-foreground">{row.summary}</span>
                </li>
              ))}
              {evidenceState.data.evidence.length === 0 && (
                <li className="text-[12.5px] text-muted-foreground">No evidence rows recorded for this opportunity.</li>
              )}
            </ul>
          )}
          <p className="text-[11px] text-subtle-foreground mt-2.5 pt-2.5 border-t border-border">
            Formula v{opportunity.scoringFormulaVersion} · last updated {formatDate(opportunity.updatedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
