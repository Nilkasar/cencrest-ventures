"use client";

import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@bebest/ui";
import { PropertyList } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import { RECOMMENDATION_STRENGTH_LABEL, providerLabel } from "@/data/ai-visibility/labels";
import { formatDateTime } from "@/lib/format";
import { ExtractionBadge, SentimentBadge } from "./status-badges";

/**
 * The last hop of score → formula → observation → raw answer: the exact
 * text the model returned, beside what was read from it, so a user can
 * check the reading against the source. The raw text renders even when
 * extraction failed — evidence is saved before extraction runs.
 */
export function ResponseDetailDialog({
  response,
  queryMeta,
  open,
  onOpenChange,
}: {
  response: AiRunResponse | null;
  queryMeta: AiVisibilityQueryMeta | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const obs = response?.observation ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {response && (
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{queryMeta?.text ?? "AI answer"}</DialogTitle>
            <DialogDescription>
              {providerLabel(response.provider)} · {formatDateTime(response.createdAt)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <ExtractionBadge status={response.extractionStatus} />
              <Badge variant="outline" size="sm">
                {response.model}
              </Badge>
              <Badge variant="outline" size="sm">
                Prompt {response.promptVersion}
              </Badge>
              {response.requestId && <span className="font-mono text-[11px] text-subtle-foreground">req {response.requestId}</span>}
            </div>

            <section aria-label="Raw answer">
              <p className={`${typography.eyebrow} mb-1.5`}>Raw answer</p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-4">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{response.rawResponse}</p>
              </div>
            </section>

            {response.extractionStatus === "failed" && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3">
                <p className="text-[12.5px] font-medium text-foreground">{response.extractionError ?? "Extraction failed."}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">The raw answer above is unaffected — evidence is always saved before it&apos;s read.</p>
              </div>
            )}

            {obs && (
              <section aria-label="What we read from it">
                <p className={`${typography.eyebrow} mb-2`}>What we read from it</p>
                <div className="rounded-lg border border-border p-4">
                  <PropertyList
                    items={[
                      { label: "Mentioned", value: obs.brandMentioned ? `Yes · ${obs.brandMentionCount}×` : "No" },
                      {
                        label: "First mention",
                        value: obs.brandFirstPosition !== null ? `${Math.round(obs.brandFirstPosition * 100)}% into the answer` : null,
                      },
                      {
                        label: "Recommended",
                        value: obs.brandRecommended
                          ? obs.brandRecommendationStrength
                            ? `Yes · ${RECOMMENDATION_STRENGTH_LABEL[obs.brandRecommendationStrength]}`
                            : "Yes"
                          : "No",
                      },
                      { label: "Tone", value: obs.brandSentiment ? <SentimentBadge sentiment={obs.brandSentiment} /> : null },
                      {
                        label: "Context",
                        value: obs.brandContext ? <span className="italic text-muted-foreground">&ldquo;{obs.brandContext}&rdquo;</span> : null,
                      },
                      { label: "Competitors", value: obs.competitorsMentioned.length > 0 ? obs.competitorsMentioned.join(", ") : null },
                      {
                        label: "Cited sources",
                        value: obs.citedDomains.length > 0 ? <span className="font-mono text-[12px]">{obs.citedDomains.join(", ")}</span> : null,
                      },
                      { label: "Confidence", value: obs.extractionConfidence.charAt(0).toUpperCase() + obs.extractionConfidence.slice(1) },
                    ]}
                  />
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
