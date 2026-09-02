"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { SeoOpportunity } from "@/data/seo/types";
import { OPPORTUNITY_STATUS_BADGE_VARIANT, OPPORTUNITY_STATUS_LABEL, opportunityTypeLabel, scoreTone } from "@/data/seo/labels";

const SCORE_TONE_CLASS: Record<ReturnType<typeof scoreTone>, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">{label}</p>
      <p className="font-mono text-[15px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

/**
 * One row in the opportunity list. Score is always visible; the evidence
 * behind it (demand/coverage/complexity/difficulty — the exact formula
 * inputs `opportunity-scoring.ts` used) is one click away via the disclosure
 * toggle, per the epic's "shows its evidence, not just a bare number"
 * requirement.
 */
export function OpportunityRow({
  opportunity,
  dismissing,
  onDismiss,
}: {
  opportunity: SeoOpportunity;
  dismissing: boolean;
  onDismiss: (opportunity: SeoOpportunity) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const tone = scoreTone(opportunity.opportunityScore);

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] font-medium text-foreground truncate">{opportunity.title}</p>
            <Badge variant="outline" size="sm">
              {opportunityTypeLabel(opportunity.opportunityType)}
            </Badge>
            <Badge variant={OPPORTUNITY_STATUS_BADGE_VARIANT[opportunity.status]} size="sm">
              {OPPORTUNITY_STATUS_LABEL[opportunity.status]}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-accent hover:underline underline-offset-4"
          >
            {showEvidence ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showEvidence ? "Hide evidence" : "Show evidence"}
          </button>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <MiniStat label="Value" value={opportunity.valueScore} />
          <MiniStat label="Effort" value={opportunity.effortScore} />
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground">Score</p>
            <p className={`font-mono text-[20px] font-semibold ${SCORE_TONE_CLASS[tone]}`}>{opportunity.opportunityScore}</p>
          </div>
          {opportunity.status !== "dismissed" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-subtle-foreground hover:text-danger"
              aria-label={`Dismiss "${opportunity.title}"`}
              loading={dismissing}
              onClick={() => onDismiss(opportunity)}
            >
              <X size={14} />
            </Button>
          )}
        </div>
      </div>

      {showEvidence && opportunity.evidence && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div>
            <p className="text-[11px] text-subtle-foreground">Demand</p>
            <p className="font-mono text-[13px] text-foreground">{opportunity.evidence.demandScore}/100</p>
          </div>
          <div>
            <p className="text-[11px] text-subtle-foreground">Current coverage</p>
            <p className="font-mono text-[13px] text-foreground">{Math.round(opportunity.evidence.currentCoverage * 100)}%</p>
          </div>
          <div>
            <p className="text-[11px] text-subtle-foreground">Content complexity</p>
            <p className="font-mono text-[13px] text-foreground">{opportunity.evidence.contentComplexity}/100</p>
          </div>
          <div>
            <p className="text-[11px] text-subtle-foreground">Technical difficulty</p>
            <p className="font-mono text-[13px] text-foreground">{opportunity.evidence.technicalDifficulty}/100</p>
          </div>
        </div>
      )}
    </div>
  );
}
