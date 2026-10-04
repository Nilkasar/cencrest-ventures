"use client";

import { useId, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Badge, Button, cn } from "@bebest/ui";
import { typography } from "@/components/patterns/typography";
import type { SeoOpportunity } from "@/data/seo/types";
import { opportunityTypeLabel, scoreTone } from "@/data/seo/labels";
import { Meter, SeoOpportunityStatusBadge, TONE_TEXT } from "./status-badges";

/**
 * One row of the SEO opportunity list (an `<li>`). The composite score is
 * always visible with the two numbers it's built from (value, effort);
 * the formula inputs behind those — demand, current coverage, content
 * complexity, technical difficulty — are one click away.
 */
export function OpportunityRow({
  opportunity,
  rank,
  dismissing,
  onDismiss,
}: {
  opportunity: SeoOpportunity;
  rank: number;
  dismissing: boolean;
  onDismiss: (opportunity: SeoOpportunity) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const evidenceId = useId();
  const tone = scoreTone(opportunity.opportunityScore);
  const dismissed = opportunity.status === "dismissed";

  return (
    <li className={cn("px-5 py-4", dismissed && "bg-surface/40")}>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:grid-cols-[3rem_minmax(0,1fr)_11rem_auto]">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className={cn("font-mono text-[20px] font-semibold leading-none tabular-nums", dismissed ? "text-muted-foreground" : TONE_TEXT[tone])}>
            {opportunity.opportunityScore}
          </span>
          <span className="font-mono text-[10px] text-subtle-foreground">#{rank}</span>
          <span className="sr-only">Opportunity score {opportunity.opportunityScore} of 100, ranked {rank}</span>
        </div>

        <div className="min-w-0">
          <p className={cn("text-[13.5px] font-medium leading-snug", dismissed ? "text-muted-foreground" : "text-foreground")}>{opportunity.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" size="sm">
              {opportunityTypeLabel(opportunity.opportunityType)}
            </Badge>
            <SeoOpportunityStatusBadge status={opportunity.status} />
          </div>
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            aria-expanded={showEvidence}
            aria-controls={evidenceId}
            className="-ml-1 mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[12px] font-medium text-accent hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight size={12} className={cn("transition-transform duration-200 motion-reduce:transition-none", showEvidence && "rotate-90")} aria-hidden="true" />
            {showEvidence ? "Hide how it's scored" : "How it's scored"}
          </button>
        </div>

        <dl className="col-span-2 col-start-2 row-start-2 flex flex-col gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:pt-1">
          <Factor label="Value" value={opportunity.valueScore} fill="bg-foreground/70" hint="higher is better" />
          <Factor label="Effort" value={opportunity.effortScore} fill="bg-subtle-foreground" hint="lower is better" />
        </dl>

        <div className="col-start-3 row-start-1 sm:col-start-4">
          {!dismissed && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-subtle-foreground hover:text-danger"
              aria-label={`Dismiss "${opportunity.title}"`}
              loading={dismissing}
              onClick={() => onDismiss(opportunity)}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {showEvidence && (
        <div id={evidenceId} className="mt-3 rounded-lg border border-border bg-surface/60 px-4 py-3 sm:ml-16">
          {opportunity.evidence ? (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <EvidenceFactor label="Search demand" value={opportunity.evidence.demandScore} display={`${opportunity.evidence.demandScore}/100`} />
                <EvidenceFactor
                  label="Current coverage"
                  value={Math.round(opportunity.evidence.currentCoverage * 100)}
                  display={`${Math.round(opportunity.evidence.currentCoverage * 100)}%`}
                />
                <EvidenceFactor label="Content complexity" value={opportunity.evidence.contentComplexity} display={`${opportunity.evidence.contentComplexity}/100`} />
                <EvidenceFactor
                  label="Technical difficulty"
                  value={opportunity.evidence.technicalDifficulty}
                  display={`${opportunity.evidence.technicalDifficulty}/100`}
                />
              </dl>
              <p className={cn(typography.meta, "mt-3 border-t border-border pt-2.5 text-[11.5px]")}>
                {/* Formula text is v1.0's (`apps/api/src/lib/seo/opportunity-scoring.ts`);
                    any other version shows only its version number. */}
                {opportunity.scoringFormulaVersion === "1.0" &&
                  "Value = demand × (1 − coverage) · Effort = complexity × difficulty ÷ 100 · Score = 0.7 × Value + 0.3 × Value ÷ Effort, normalized to 0–100. "}
                Formula v{opportunity.scoringFormulaVersion}.
              </p>
            </>
          ) : (
            <p className={typography.meta}>No scoring inputs were recorded for this opportunity.</p>
          )}
        </div>
      )}
    </li>
  );
}

function Factor({ label, value, fill, hint }: { label: string; value: number; fill: string; hint: string }) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_2rem] items-center gap-2">
      <dt className="text-[11.5px] text-muted-foreground">
        {label}
        <span className="sr-only"> ({hint})</span>
      </dt>
      <Meter value={value} fillClassName={fill} />
      <dd className="text-right font-mono text-[12px] tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function EvidenceFactor({ label, value, display }: { label: string; value: number; display: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[12px] text-muted-foreground">{label}</dt>
        <dd className="font-mono text-[12.5px] font-medium tabular-nums text-foreground">{display}</dd>
      </div>
      <Meter value={value} fillClassName="bg-foreground/50" />
    </div>
  );
}
