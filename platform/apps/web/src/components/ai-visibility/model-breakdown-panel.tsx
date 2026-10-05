"use client";

import { motion } from "framer-motion";
import { Bot, ChevronRight } from "lucide-react";
import { EmptyState, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SrTable } from "@/components/overview/primitives";
import type { ProviderStats } from "@/data/ai-visibility/analysis";
import { providerLabel } from "@/data/ai-visibility/labels";
import { formatNumber, formatPercent } from "@/lib/format";
import type { ResponseFilter } from "./response-filter";
import { shortProviderLabel } from "./status-badges";

/**
 * "Which assistant mentions me?" — one row per model the run actually
 * queried, the bar is that model's real mention rate. Computed from the
 * run's observed responses (the formula itself is only ever aggregate),
 * so these are observed rates, not a per-model re-derivation of the score.
 */
export function ModelBreakdownPanel({
  stats,
  onDrill,
  className,
}: {
  stats: ProviderStats[];
  onDrill: (filter: ResponseFilter) => void;
  className?: string;
}) {
  const anyResponses = stats.some((s) => s.totalJobs > 0);
  return (
    <Section
      title="By model"
      description="Share of each assistant's answers that mention you. Select a model to read them."
      flush
      className={className}
    >
      {!anyResponses ? (
        <EmptyState compact icon={<Bot size={18} />} title="No answers yet" description="Each model's mention rate appears as its first answers are read." />
      ) : (
        <ul className="divide-y divide-border">
          {stats.map((s, i) => (
            <li key={s.provider}>
              <button
                type="button"
                onClick={() => onDrill({ provider: s.provider })}
                disabled={s.totalJobs === 0}
                aria-label={`${providerLabel(s.provider)}: ${s.mentionRatePct !== null ? formatPercent(s.mentionRatePct) : "no"} mention rate. Show its answers.`}
                className="group grid w-full grid-cols-[6.5rem_minmax(0,1fr)_3.25rem_14px] items-center gap-x-3 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="truncate text-[13px] font-medium text-foreground">{shortProviderLabel(s.provider)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  <motion.span
                    className="block h-full w-full origin-left rounded-full bg-accent"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: (s.mentionRatePct ?? 0) / 100 }}
                    transition={{ duration: 0.9, delay: 0.1 + i * 0.07, ease: easings.emphasized }}
                  />
                </span>
                <span className="text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground">
                  {s.mentionRatePct !== null ? formatPercent(s.mentionRatePct) : "—"}
                </span>
                <ChevronRight size={14} className="text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                <span className="col-span-3 col-start-2 text-[12px] text-muted-foreground">
                  {formatNumber(s.totalJobs)} answers · recommended in{" "}
                  {s.recommendationRatePct !== null ? formatPercent(s.recommendationRatePct) : "—"}
                  {s.avgFirstPosition !== null && ` · first mention ${Math.round(s.avgFirstPosition * 100)}% in`}
                  {s.extractionFailed > 0 && ` · ${formatNumber(s.extractionFailed)} unread`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SrTable
        caption="Mention and recommendation rate by AI model"
        head={["Model", "Answers", "Mention rate", "Recommendation rate", "Avg first-mention position", "Avg latency"]}
        rows={stats.map((s) => [
          providerLabel(s.provider),
          s.totalJobs,
          s.mentionRatePct !== null ? formatPercent(s.mentionRatePct) : "—",
          s.recommendationRatePct !== null ? formatPercent(s.recommendationRatePct) : "—",
          s.avgFirstPosition !== null ? `${Math.round(s.avgFirstPosition * 100)}%` : "—",
          s.avgLatencyMs !== null ? `${formatNumber(s.avgLatencyMs)} ms` : "—",
        ])}
      />
    </Section>
  );
}
