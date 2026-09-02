"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@bebest/ui";
import type { AiRun } from "@/data/ai-visibility/types";
import { formatDateTime } from "@/lib/format";

/**
 * A run that failed outright (e.g. every provider throws
 * `ProviderNotConfiguredError` with no credentials set — a real, honest
 * failure mode the backend doc calls out, not a silently mocked success).
 * Evidence gathered before the failure is never discarded — the detail
 * panels below this still render whatever `ai_run_responses` rows exist.
 */
export function AiRunFailedPanel({ run, retrying, onRetry }: { run: AiRun; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-muted px-6 py-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-display text-[15px] font-semibold text-foreground">Run stopped before finishing</p>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-[64ch]">
            {run.error ?? "The run failed for an unknown reason."}
          </p>
          <p className="text-[12px] text-subtle-foreground mt-1.5">
            {run.completedJobs + run.failedJobs} of {run.totalJobs} jobs were attempted
            {run.completedAt ? ` — stopped ${formatDateTime(run.completedAt)}` : ""}. Any evidence already gathered is
            preserved below.
          </p>
        </div>
      </div>
      <div>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
          Run again
        </Button>
      </div>
    </div>
  );
}
