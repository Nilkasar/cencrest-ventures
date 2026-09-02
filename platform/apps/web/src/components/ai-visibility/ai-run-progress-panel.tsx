"use client";

import { Check, Loader2 } from "lucide-react";
import { Badge, Card, CardContent, cn } from "@bebest/ui";
import type { AiRun } from "@/data/ai-visibility/types";
import { RUN_STATUS_LABEL, providerLabel } from "@/data/ai-visibility/labels";
import { formatRelativeTime } from "@/lib/format";

/**
 * Real, step-by-step run status — per the epic's UI surface note: 30–60
 * minutes "needs real step-by-step status... not a spinner." Adapted
 * directly from `crawl-progress-panel.tsx` (Epic 3): two named phases
 * (queued, then executing with live job counters), because that's the
 * actual granularity `ai_runs` reports — `total_jobs`/`completed_jobs`/
 * `failed_jobs`, incremented per (query x provider) job as
 * `lib/ai-visibility/pipeline.ts` runs. No synthesized "querying
 * OpenAI... extracting... aggregating" sub-steps are invented here: the
 * backend has no per-job phase signal beyond the job either not existing
 * yet, existing with `extraction_status: pending`, or being counted into
 * `completed_jobs`/`failed_jobs` — this panel renders exactly that.
 */
export function AiRunProgressPanel({ run }: { run: AiRun }) {
  const queued = run.status === "queued";
  const done = run.completedJobs + run.failedJobs;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col gap-1 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-[16px] font-semibold text-foreground">
              Running your baseline across {run.providers.map(providerLabel).join(", ")}
            </p>
            {run.startedAt && (
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Started {formatRelativeTime(run.startedAt)} — this typically takes 30–60 minutes; you can leave this page and
                come back.
              </p>
            )}
          </div>
          <Badge variant="accent" size="md" dot>
            {RUN_STATUS_LABEL[run.status]}
          </Badge>
        </div>

        <ol role="status" aria-live="polite" className="flex flex-col">
          <li className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon active={queued} done={!queued} />
              <div className={cn("w-px flex-1 min-h-[28px] my-0.5", !queued ? "bg-accent" : "bg-border")} aria-hidden="true" />
            </div>
            <div className="pb-6">
              <p className={cn("text-[13.5px] font-medium", queued ? "text-foreground" : "text-muted-foreground")}>Queued</p>
              <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-[52ch]">
                Waiting for a slot — checked your monthly AI-query entitlement before this run was even created.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon active={!queued} done={false} />
            </div>
            <div>
              <p className={cn("text-[13.5px] font-medium", queued ? "text-muted-foreground" : "text-foreground")}>
                Querying models &amp; extracting evidence
              </p>
              <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-[56ch]">
                Every query is sent to each model, the raw answer is saved immediately, then a separate extraction pass reads
                whether your brand was mentioned, recommended, and how it was described.
              </p>
              {!queued && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-3 font-mono text-[12px] text-foreground">
                    <span>
                      {done} of {run.totalJobs} jobs done
                    </span>
                    {run.failedJobs > 0 && <span className="text-danger">{run.failedJobs} failed</span>}
                  </div>
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                      style={{ width: `${run.progressPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function StepIcon({ active, done }: { active: boolean; done: boolean }) {
  if (done) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-muted text-accent">
        <Check size={14} />
      </span>
    );
  }
  if (active) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-accent-foreground">
        <Loader2 size={14} className="animate-[spin_0.9s_linear_infinite]" />
      </span>
    );
  }
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface" aria-hidden="true" />;
}
