"use client";

import { Link2, SmilePlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@bebest/ui";
import type { AiRunResponse, BrandSentiment } from "@/data/ai-visibility/types";
import { computeCitationMap, computeSentimentMix } from "@/data/ai-visibility/analysis";
import { SENTIMENT_LABEL } from "@/data/ai-visibility/labels";
import type { ResponseFilter } from "./response-filter";

const SENTIMENT_ORDER: BrandSentiment[] = ["positive", "neutral", "mixed", "negative"];

const SENTIMENT_BAR_CLASS: Record<BrandSentiment, string> = {
  positive: "bg-success",
  neutral: "bg-subtle-foreground",
  mixed: "bg-warning",
  negative: "bg-danger",
};

const CITATION_ROWS = 12;

/**
 * Citation source map + sentiment analysis — the last two items on the
 * epic's UI-surface list, combined into one tab since both are the same
 * shape of thing: a distribution over `brand_observations` fields, each
 * bucket clickable into the exact responses behind it.
 */
export function CitationSentimentPanel({
  responses,
  loading,
  onDrill,
}: {
  responses: AiRunResponse[];
  loading: boolean;
  onDrill: (filter: ResponseFilter) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const domains = computeCitationMap(responses).slice(0, CITATION_ROWS);
  const sentiment = computeSentimentMix(responses);
  const maxDomainCitations = domains[0]?.citations ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Citation source map</CardTitle>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <EmptyState
              compact
              icon={<Link2 size={18} />}
              title="No cited sources yet"
              description="None of the responses gathered so far cite an external URL."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {domains.map((d) => (
                <button
                  key={d.domain}
                  type="button"
                  onClick={() => onDrill({ citedDomain: d.domain })}
                  className="group flex flex-col gap-1 text-left rounded-md p-1.5 -mx-1.5 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] text-foreground truncate">{d.domain}</span>
                    <span className="font-mono text-[12px] text-muted-foreground shrink-0">
                      {d.citations} citation{d.citations === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] group-hover:brightness-110"
                      style={{ width: `${maxDomainCitations > 0 ? (d.citations / maxDomainCitations) * 100 : 0}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sentiment when mentioned</CardTitle>
        </CardHeader>
        <CardContent>
          {sentiment.totalMentioned === 0 ? (
            <EmptyState
              compact
              icon={<SmilePlus size={18} />}
              title="No mentions extracted yet"
              description="Sentiment is only extracted for responses that mention your brand — none have been found so far."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {SENTIMENT_ORDER.map((key) => {
                const count = sentiment.counts[key];
                const pct = sentiment.totalMentioned > 0 ? Math.round((count / sentiment.totalMentioned) * 100) : 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onDrill({ sentiment: key, mentioned: true })}
                    className="group flex flex-col gap-1 text-left rounded-md p-1.5 -mx-1.5 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-foreground">{SENTIMENT_LABEL[key]}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                      <div className={`h-full rounded-full ${SENTIMENT_BAR_CLASS[key]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                );
              })}
              {sentiment.unrated > 0 && (
                <p className="text-[11.5px] text-subtle-foreground mt-1">
                  {sentiment.unrated} mention{sentiment.unrated === 1 ? "" : "s"} extracted without a sentiment value.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
