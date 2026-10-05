"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { FilterSelect } from "@/components/patterns/toolbar";
import { GAP_TYPE_DESCRIPTION, GAP_TYPE_LABEL } from "@/data/competitive-intelligence/labels";
import type { CompetitiveGapsResponse, GapFinding, GapType } from "@/data/competitive-intelligence/types";
import { GapTypeBadge, SeverityBadge } from "./status-badges";

type FilterValue = "all" | GapType;

const GAP_TYPE_ORDER: GapType[] = ["intent_gap", "content_gap", "entity_gap", "source_gap"];

/**
 * The four classified gap types — each a distinct finding the Opportunity
 * Engine consumes directly, so the list keeps that structure (type badge +
 * severity) instead of one generic "you're behind" feed. High severity
 * sorts first.
 */
export function GapFindingsPanel({ gaps }: { gaps: CompetitiveGapsResponse }) {
  const [filter, setFilter] = useState<FilterValue>("all");

  const counts = useMemo(() => {
    const c: Record<GapType, number> = { intent_gap: 0, content_gap: 0, entity_gap: 0, source_gap: 0 };
    for (const g of gaps.gaps) c[g.gapType]++;
    return c;
  }, [gaps.gaps]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? gaps.gaps : gaps.gaps.filter((g) => g.gapType === filter);
    return [...list].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  }, [gaps.gaps, filter]);

  return (
    <Section
      title="Gap findings"
      description="Every query, category and source a competitor wins that you don't — classified."
      icon={<ListChecks size={14} />}
      flush
      actions={
        gaps.gaps.length > 0 ? (
          <FilterSelect
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "all", label: `All types (${gaps.gaps.length})` },
              ...GAP_TYPE_ORDER.filter((t) => counts[t] > 0).map((t) => ({ value: t, label: `${GAP_TYPE_LABEL[t]} (${counts[t]})` })),
            ]}
            label="Filter by gap type"
            className="h-8 sm:w-44"
          />
        ) : undefined
      }
      footer={
        gaps.gaps.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/opportunities">
              See opportunities <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Button>
        ) : undefined
      }
    >
      {gaps.gaps.length === 0 ? (
        <EmptyState
          compact
          icon={<ListChecks size={18} />}
          title={gaps.computed ? "No gaps found" : "Nothing to classify yet"}
          description={
            gaps.computed
              ? "No competitor beats you on any query, category or source in their latest runs. New gaps appear here after each competitor check."
              : "Run your AI Visibility baseline, then at least one competitor check, to see classified gaps."
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((finding, i) => (
            <GapFindingRow key={`${finding.gapType}-${i}`} finding={finding} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function subjectOf(finding: GapFinding): { title: string; mono: boolean } {
  switch (finding.gapType) {
    case "intent_gap":
    case "content_gap":
      return { title: `“${finding.queryText}”`, mono: false };
    case "entity_gap":
      return { title: `${finding.category} category`, mono: false };
    case "source_gap":
      return { title: finding.domain, mono: true };
  }
}

function GapFindingRow({ finding }: { finding: GapFinding }) {
  const subject = subjectOf(finding);
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className={subject.mono ? "font-mono text-[12.5px] text-foreground" : "text-[13.5px] font-medium text-foreground"}>{subject.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {finding.gapType === "intent_gap" && (
            <>
              You appear in {finding.yourMentionRatePct}% of answers; {finding.competitors.map((c) => `${c.competitorName} in ${c.mentionRatePct}%`).join(", ")}.
            </>
          )}
          {finding.gapType === "content_gap" && (
            <>
              AI cites {finding.citedDomains.length === 1 ? "a source" : "sources"} you have no content on:{" "}
              <span className="font-mono text-[12px]">{finding.citedDomains.join(", ")}</span>.
            </>
          )}
          {finding.gapType === "entity_gap" && (
            <>
              You have {finding.yourPresencePct}% presence; {finding.competitors.map((c) => `${c.competitorName} has ${c.presencePct}%`).join(", ")}.
            </>
          )}
          {finding.gapType === "source_gap" && (
            <>
              Cited for your queries but never for you; {finding.citedByCompetitors.map((c) => `${c.competitorName} cited ${c.citationRatePct}% of the time`).join(", ")}.
            </>
          )}
        </p>
        <p className="mt-1 text-[12px] text-subtle-foreground">{GAP_TYPE_DESCRIPTION[finding.gapType]}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:pt-0.5">
        <SeverityBadge severity={finding.severity} />
        <GapTypeBadge type={finding.gapType} />
      </div>
    </li>
  );
}
