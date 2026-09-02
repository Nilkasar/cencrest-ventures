"use client";

import type { ReactNode } from "react";
import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@bebest/ui";
import type { AiRunResponse, AiVisibilityQueryMeta } from "@/data/ai-visibility/types";
import {
  EXTRACTION_STATUS_BADGE_VARIANT,
  EXTRACTION_STATUS_LABEL,
  RECOMMENDATION_STRENGTH_LABEL,
  SENTIMENT_BADGE_VARIANT,
  SENTIMENT_LABEL,
  providerLabel,
} from "@/data/ai-visibility/labels";
import { formatDateTime } from "@/lib/format";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">{label}</p>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  );
}

/**
 * The bottom of the drill-down chain: score -> formula component ->
 * observation -> this. Shows the exact raw AI response text alongside the
 * structured fields `brand_observations` extracted from it, so a user can
 * check the extraction against the source themselves — the evidence-
 * traceability guarantee made concrete, not just promised. `rawResponse`
 * is rendered even when `extractionStatus === "failed"`: the evidence was
 * committed before extraction was attempted and is never lost to an
 * extraction bug (the epic's DoD hard gate).
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {response && (
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{providerLabel(response.provider)}</DialogTitle>
            <DialogDescription>
              {queryMeta?.text ?? `Query ${response.queryId}`} — {formatDateTime(response.createdAt)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={EXTRACTION_STATUS_BADGE_VARIANT[response.extractionStatus]} size="sm">
                {EXTRACTION_STATUS_LABEL[response.extractionStatus]}
              </Badge>
              <Badge variant="outline" size="sm">
                {response.model}
              </Badge>
              <Badge variant="outline" size="sm">
                Prompt {response.promptVersion}
              </Badge>
              {response.requestId && (
                <span className="font-mono text-[11px] text-subtle-foreground">req {response.requestId}</span>
              )}
            </div>

            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1.5">
                Raw response
              </p>
              <div className="rounded-lg border border-border bg-surface p-4 max-h-72 overflow-y-auto">
                <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{response.rawResponse}</p>
              </div>
            </div>

            {response.extractionStatus === "failed" && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger-muted p-3">
                <p className="text-[12.5px] text-danger">{response.extractionError ?? "Extraction failed."}</p>
                <p className="text-[11.5px] text-muted-foreground mt-1">
                  The raw response above is unaffected — evidence is always saved before extraction runs.
                </p>
              </div>
            )}

            {response.observation && (
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-2">
                  Extracted observation
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border p-4">
                  <Field label="Brand mentioned">{response.observation.brandMentioned ? "Yes" : "No"}</Field>
                  <Field label="Mention count">{response.observation.brandMentionCount}</Field>
                  <Field label="First position">
                    {response.observation.brandFirstPosition !== null
                      ? `${Math.round(response.observation.brandFirstPosition * 100)}% into the response`
                      : "—"}
                  </Field>
                  <Field label="Sentiment">
                    {response.observation.brandSentiment ? (
                      <Badge variant={SENTIMENT_BADGE_VARIANT[response.observation.brandSentiment]} size="sm">
                        {SENTIMENT_LABEL[response.observation.brandSentiment]}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label="Recommended">
                    {response.observation.brandRecommended
                      ? response.observation.brandRecommendationStrength
                        ? RECOMMENDATION_STRENGTH_LABEL[response.observation.brandRecommendationStrength]
                        : "Yes"
                      : "No"}
                  </Field>
                  <Field label="Extraction confidence">{response.observation.extractionConfidence}</Field>
                  {response.observation.brandContext && (
                    <div className="col-span-2">
                      <Field label="Context">
                        <span className="text-muted-foreground italic">&ldquo;{response.observation.brandContext}&rdquo;</span>
                      </Field>
                    </div>
                  )}
                  {response.observation.competitorsMentioned.length > 0 && (
                    <div className="col-span-2">
                      <Field label="Competitors mentioned">{response.observation.competitorsMentioned.join(", ")}</Field>
                    </div>
                  )}
                  {response.observation.citedDomains.length > 0 && (
                    <div className="col-span-2">
                      <Field label="Cited sources">{response.observation.citedDomains.join(", ")}</Field>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
