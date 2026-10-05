"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Link2, SmilePlus } from "lucide-react";
import { Button, EmptyState, cn, easings } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SrTable } from "@/components/overview/primitives";
import type { AiRunResponse, BrandSentiment } from "@/data/ai-visibility/types";
import { computeCitationMap, computeSentimentMix } from "@/data/ai-visibility/analysis";
import { SENTIMENT_LABEL } from "@/data/ai-visibility/labels";
import { formatNumber, formatPercent } from "@/lib/format";
import type { ResponseFilter } from "./response-filter";

const SENTIMENT_ORDER: BrandSentiment[] = ["positive", "neutral", "mixed", "negative"];

/** Sentiment is an outcome, so it uses the outcome tones (with labels). */
const SENTIMENT_FILL: Record<BrandSentiment, string> = {
  positive: "bg-success",
  neutral: "bg-subtle-foreground",
  mixed: "bg-warning",
  negative: "bg-danger",
};

const CITATION_ROWS = 8;

/**
 * "Where do AI answers come from?" — every domain the extracted
 * observations cite, ranked. Each row narrows the Responses explorer to the
 * answers that cite it.
 */
export function CitationPanel({
  responses,
  onDrill,
  className,
}: {
  responses: AiRunResponse[];
  onDrill: (filter: ResponseFilter) => void;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const all = computeCitationMap(responses);
  const domains = showAll ? all : all.slice(0, CITATION_ROWS);
  const max = all[0]?.citations ?? 0;

  return (
    <Section
      title="Sources AI cites"
      description="The sites assistants point to when they answer your queries."
      flush
      className={className}
      footer={
        all.length > CITATION_ROWS ? (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? "Show top sources" : `Show all ${formatNumber(all.length)} sources`}
          </Button>
        ) : undefined
      }
    >
      {all.length === 0 ? (
        <EmptyState compact icon={<Link2 size={18} />} title="No cited sources yet" description="None of the answers read so far cite a web source. Sources appear here as answers that cite one are read." />
      ) : (
        <ol className="divide-y divide-border">
          {domains.map((d, i) => (
            <li key={d.domain}>
              <button
                type="button"
                onClick={() => onDrill({ citedDomain: d.domain })}
                aria-label={`${d.domain}: cited ${d.citations} times in ${d.responseCount} answers. Show those answers.`}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="truncate font-mono text-[12.5px] text-foreground group-hover:text-accent">{d.domain}</span>
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatNumber(d.citations)}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  <motion.span
                    className="block h-full w-full origin-left rounded-full bg-border-strong group-hover:bg-accent"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: max > 0 ? d.citations / max : 0 }}
                    transition={{ duration: 0.8, delay: Math.min(i, 8) * 0.05, ease: easings.emphasized }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <SrTable caption="Cited source domains" head={["Domain", "Citations", "Answers citing it"]} rows={all.map((d) => [d.domain, d.citations, d.responseCount])} />
    </Section>
  );
}

/**
 * "How do they describe me?" — sentiment over the answers that mention you
 * (sentiment is only meaningful once the brand was discussed). One stacked
 * bar for the mix, then a labelled row per bucket that drills in.
 */
export function SentimentPanel({
  responses,
  onDrill,
  className,
}: {
  responses: AiRunResponse[];
  onDrill: (filter: ResponseFilter) => void;
  className?: string;
}) {
  const mix = computeSentimentMix(responses);
  const pctOf = (n: number) => (mix.totalMentioned > 0 ? (n / mix.totalMentioned) * 100 : 0);

  return (
    <Section title="Tone when mentioned" description={mix.totalMentioned > 0 ? `Across ${formatNumber(mix.totalMentioned)} answers that mention you.` : "How assistants describe you when they bring you up."} className={className}>
      {mix.totalMentioned === 0 ? (
        <EmptyState compact icon={<SmilePlus size={18} />} title="No mentions read yet" description="Tone is only read from answers that mention you. None have so far — check the By model panel for which assistants are close." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {SENTIMENT_ORDER.filter((k) => mix.counts[k] > 0).map((k) => (
              <motion.span
                key={k}
                className={cn("h-full first:rounded-l-full last:rounded-r-full", SENTIMENT_FILL[k])}
                style={{ width: `${pctOf(mix.counts[k])}%` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              />
            ))}
          </div>
          <ul className="-mx-2 flex flex-col">
            {SENTIMENT_ORDER.map((k) => {
              const count = mix.counts[k];
              return (
                <li key={k}>
                  <button
                    type="button"
                    disabled={count === 0}
                    onClick={() => onDrill({ sentiment: k, mentioned: true })}
                    className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55"
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", SENTIMENT_FILL[k])} aria-hidden="true" />
                    <span className="flex-1 text-[13px] text-foreground">{SENTIMENT_LABEL[k]}</span>
                    <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatNumber(count)}</span>
                    <span className="w-11 text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground">{formatPercent(pctOf(count))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {mix.unrated > 0 && (
            <p className="text-[12px] text-muted-foreground">
              {formatNumber(mix.unrated)} mention{mix.unrated === 1 ? "" : "s"} had no clear tone and aren&apos;t counted above.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
