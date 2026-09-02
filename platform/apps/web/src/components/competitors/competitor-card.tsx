"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@bebest/ui";
import type { Competitor } from "@/data/types";
import { COMPETITOR_PRIORITY_LABEL, COMPETITOR_PRIORITY_VARIANT } from "@/data/brand-constants";
import { RUN_STATUS_BADGE_VARIANT, RUN_STATUS_LABEL } from "@/data/ai-visibility/labels";
import { useCompetitorAiRun } from "@/hooks/use-competitor-ai-run";
import { AiRunProgressPanel } from "@/components/ai-visibility/ai-run-progress-panel";
import { AiRunFailedPanel } from "@/components/ai-visibility/ai-run-failed-panel";
import { AiRunDetail } from "@/components/ai-visibility/ai-run-detail";
import { CompetitorRunStartError } from "./competitor-run-start-error";

/**
 * One tracked competitor — the "Competitor AVS list" the epic's UI surface
 * asks for, one card at a time rather than a dense table row, because a
 * card can grow into the FULL Epic 7 drill-down (score -> formula ->
 * observation -> raw response) when expanded, exactly the "reuse Epic 7's
 * AI-run progress/history UI patterns" instruction — `AiRunDetail` here is
 * the literal same component the AI Visibility screen renders, pointed at
 * this competitor's own `ai_runs` row instead of the brand's.
 */
export function CompetitorCard({
  competitor,
  onEdit,
  onRemove,
  removing = false,
}: {
  competitor: Competitor;
  onEdit: (competitor: Competitor) => void;
  onRemove: (competitor: Competitor) => void;
  removing?: boolean;
}) {
  const { state, starting, startError, start } = useCompetitorAiRun(competitor.id);
  const [expanded, setExpanded] = useState(false);

  const run = state.status === "ready" ? state.run : null;
  const inFlight = run !== null && (run.status === "queued" || run.status === "running");
  const hasResults = run !== null && (run.status === "completed" || run.status === "failed");

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-display text-[15px] font-semibold text-foreground truncate">{competitor.name}</p>
                <Badge variant={COMPETITOR_PRIORITY_VARIANT[competitor.priority]} size="sm">
                  {COMPETITOR_PRIORITY_LABEL[competitor.priority]}
                </Badge>
              </div>
              {competitor.websiteUrl && (
                <Link
                  href={competitor.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-accent mt-0.5"
                >
                  {competitor.websiteUrl.replace(/^https?:\/\//, "")}
                  <ExternalLink size={11} />
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-subtle-foreground">AVS</p>
              <p className="font-mono text-[20px] font-semibold text-foreground leading-none mt-0.5">
                {run?.aiVisibilityScore !== null && run?.aiVisibilityScore !== undefined ? run.aiVisibilityScore.toFixed(1) : "—"}
              </p>
            </div>
            {run && (
              <Badge variant={RUN_STATUS_BADGE_VARIANT[run.status]} size="sm">
                {RUN_STATUS_LABEL[run.status]}
              </Badge>
            )}
            <Button variant={run ? "outline" : "primary"} size="sm" loading={starting} disabled={inFlight} onClick={() => void start()}>
              {run ? <RefreshCw size={13} /> : null}
              {run ? "Run again" : "Run first check"}
            </Button>
            {hasResults && (
              <Button variant="ghost" size="icon" aria-label={expanded ? "Collapse details" : "Expand details"} onClick={() => setExpanded((v) => !v)}>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label={`Edit ${competitor.name}`} onClick={() => onEdit(competitor)}>
              <Pencil size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${competitor.name}`}
              loading={removing}
              onClick={() => onRemove(competitor)}
              className="text-danger hover:bg-danger-muted hover:text-danger"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {state.status === "loading" && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 size={13} className="animate-[spin_0.9s_linear_infinite]" /> Loading run history…
          </p>
        )}

        {startError !== null && <CompetitorRunStartError error={startError} />}

        {inFlight && run && <AiRunProgressPanel run={run} />}

        {run && run.status === "failed" && <AiRunFailedPanel run={run} retrying={starting} onRetry={() => void start()} />}

        {expanded && run && hasResults && (
          <div className="pt-1 border-t border-border">
            <div className="pt-4">
              <AiRunDetail run={run} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
