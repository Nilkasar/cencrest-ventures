"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { Button, EmptyState, cn, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { FilterSelect } from "@/components/patterns/toolbar";
import { SectionSkeleton } from "@/components/patterns/states";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { typography } from "@/components/patterns/typography";
import { SrTable } from "@/components/overview/primitives";
import type { AsyncState } from "@/lib/use-async-data";
import { intentTypeLabel } from "@/data/competitive-intelligence/labels";
import type { Competitor } from "@/data/types";
import type { CompetitiveGapsResponse, PerQueryBreakdownRow, PerQueryCompetitorRow } from "@/data/competitive-intelligence/types";
import { GapValue } from "./status-badges";

interface EvidenceRow {
  row: PerQueryBreakdownRow;
  competitor: PerQueryCompetitorRow;
}

const EVIDENCE_PREVIEW = 5;

function positionLabel(position: 1 | 2 | 3 | 4 | null): string {
  return position === null ? "not mentioned" : `position ${position}`;
}

/**
 * Head-to-head: you vs. one competitor, per intent (paired bars, gap on
 * the right) and per query (the signature evidence sentence). One
 * competitor at a time keeps it readable; on a competitor's own page the
 * picker is locked to them.
 */
export function CompetitiveGapPanel({
  competitors,
  state,
  onRetry,
  lockedCompetitorId,
  className,
}: {
  competitors: Competitor[];
  state: AsyncState<CompetitiveGapsResponse | null>;
  onRetry: () => void;
  lockedCompetitorId?: string;
  className?: string;
}) {
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const gaps = state.status === "success" ? state.data : null;
  // Derived at render (never effect + setState): the first competitor with
  // a comparable run, unless the user picked one.
  const defaultSelectedId = gaps
    ? (gaps.competitors.find((c) => c.run !== null)?.competitorId ?? gaps.competitors[0]?.competitorId ?? competitors[0]?.id ?? null)
    : null;
  const selectedId = lockedCompetitorId ?? explicitSelectedId ?? defaultSelectedId;
  const selected = gaps?.competitors.find((c) => c.competitorId === selectedId) ?? null;
  const selectedName = selected?.competitorName ?? competitors.find((c) => c.id === selectedId)?.name ?? "this competitor";

  const evidenceRows = useMemo<EvidenceRow[]>(() => {
    if (!gaps || !selectedId) return [];
    const rows: EvidenceRow[] = [];
    for (const row of gaps.perQueryBreakdown) {
      const competitor = row.competitors.find((c) => c.competitorId === selectedId);
      if (competitor) rows.push({ row, competitor });
    }
    // Biggest deficits first — the queries worth acting on.
    return rows.sort((a, b) => b.competitor.stats.mentionRatePct - b.row.yourStats.mentionRatePct - (a.competitor.stats.mentionRatePct - a.row.yourStats.mentionRatePct));
  }, [gaps, selectedId]);
  const shownEvidence = showAllEvidence ? evidenceRows : evidenceRows.slice(0, EVIDENCE_PREVIEW);

  const picker =
    !lockedCompetitorId && gaps && gaps.computed && gaps.competitors.length > 1 ? (
      <FilterSelect
        value={selectedId ?? ""}
        onValueChange={(v) => {
          setExplicitSelectedId(v);
          setShowAllEvidence(false);
        }}
        options={gaps.competitors.map((c) => ({ value: c.competitorId, label: c.run === null ? `${c.competitorName} (not run)` : c.competitorName }))}
        label="Compare against"
        className="h-8 sm:w-48"
      />
    ) : undefined;

  return (
    <Section
      title={lockedCompetitorId ? "Head-to-head" : "Competitive gap"}
      description="Where a competitor beats you in AI answers, by intent and by query."
      icon={<Target size={14} />}
      actions={picker}
      className={className}
      footer={
        evidenceRows.length > EVIDENCE_PREVIEW ? (
          <Button variant="ghost" size="sm" onClick={() => setShowAllEvidence((v) => !v)} aria-expanded={showAllEvidence}>
            {showAllEvidence ? "Show fewer queries" : `Show all ${evidenceRows.length} queries`}
          </Button>
        ) : undefined
      }
    >
      {state.status === "loading" && <SectionSkeleton lines={4} className="border-0 p-0 shadow-none" />}
      {state.status === "error" && <ErrorPanel compact title="Gaps didn't load" message={state.error.message} onRetry={onRetry} />}

      {state.status === "success" && gaps === null && (
        <GapEmpty
          title="No active query set"
          description="Gaps compare your latest run and each competitor's on your active query set. Activate one first."
          href="/query-universe"
          label="Open Query Universe"
        />
      )}
      {state.status === "success" && gaps !== null && !gaps.computed && (
        <GapEmpty
          title="Run your AI Visibility baseline first"
          description="Gaps need your own completed run on the active query set to compare against."
          href="/ai-visibility"
          label="Go to AI Visibility"
        />
      )}
      {state.status === "success" && gaps !== null && gaps.computed && !selected && (
        <EmptyState compact icon={<Target size={18} />} title="Nothing to compare yet" description="Run a check on a competitor to see where they beat you." />
      )}

      {state.status === "success" && gaps !== null && gaps.computed && selected && (
        <div className="flex flex-col gap-5">
          <p className={typography.body}>
            <span className="font-medium">{selectedName}</span>{" "}
            {selected.run === null ? (
              <span className="text-muted-foreground">hasn&apos;t been run on this query set yet — run a check to compare.</span>
            ) : (
              <>
                is <GapValue gap={selected.competitiveGap} className="text-[13.5px]" /> you overall.
              </>
            )}
          </p>

          {selected.perIntentTypeGap.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-4 text-[12px] text-muted-foreground" aria-hidden="true">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-accent" /> You
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-border-strong" /> {selectedName}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {selected.perIntentTypeGap.map((row, i) => (
                  <li key={row.intentType} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">{intentTypeLabel(row.intentType)}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {row.queryCount} {row.queryCount === 1 ? "query" : "queries"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5" aria-hidden="true">
                      <PairBar value={row.yourScore} you delay={i * 0.06} />
                      <PairBar value={row.competitorScore} delay={i * 0.06 + 0.03} />
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                        {row.yourScore.toFixed(1)} · {row.competitorScore.toFixed(1)}
                      </span>
                      <GapValue gap={row.gap} />
                    </div>
                  </li>
                ))}
              </ul>
              <SrTable
                caption={`Score by intent, you versus ${selectedName}`}
                head={["Intent", "Queries", "Your score", `${selectedName} score`, "Gap"]}
                rows={selected.perIntentTypeGap.map((r) => [intentTypeLabel(r.intentType), r.queryCount, r.yourScore.toFixed(1), r.competitorScore.toFixed(1), r.gap.toFixed(1)])}
              />
            </div>
          )}

          {evidenceRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className={typography.eyebrow}>Query evidence · biggest gaps first</p>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {shownEvidence.map(({ row, competitor }) => (
                  <li key={row.queryId} className="flex flex-col gap-1 px-4 py-3">
                    <p className="text-[13px] leading-relaxed text-foreground">{competitor.sentence}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {row.intentType ? intentTypeLabel(row.intentType) : "Uncategorized"} · you: {positionLabel(row.yourStats.position)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function PairBar({ value, you = false, delay }: { value: number; you?: boolean; delay: number }) {
  return (
    <span className="h-1.5 overflow-hidden rounded-full bg-surface">
      <motion.span
        className={cn("block h-full w-full origin-left rounded-full", you ? "bg-accent" : "bg-border-strong")}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.max(0, Math.min(100, value)) / 100 }}
        transition={{ duration: 0.8, delay: 0.1 + delay, ease: easings.emphasized }}
      />
    </span>
  );
}

function GapEmpty({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return (
    <EmptyState
      compact
      icon={<Target size={18} />}
      title={title}
      description={description}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={href}>{label}</Link>
        </Button>
      }
    />
  );
}
