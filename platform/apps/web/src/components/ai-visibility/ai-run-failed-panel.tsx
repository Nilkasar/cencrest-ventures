"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@bebest/ui";
import type { AiRun } from "@/data/ai-visibility/types";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * A run that failed outright (e.g. no provider credentials configured — an
 * honest failure, never a mocked success). Evidence gathered before the
 * failure is preserved and still rendered below this banner.
 */
export function AiRunFailedPanel({ run, retrying, onRetry }: { run: AiRun; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-muted px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-foreground">Run stopped before finishing</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{run.error ?? "The run failed for an unknown reason."}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {formatNumber(run.completedJobs + run.failedJobs)} of {formatNumber(run.totalJobs)} answers attempted
            {run.completedAt ? ` · stopped ${formatDateTime(run.completedAt)}` : ""}. Evidence already gathered is kept below.
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" loading={retrying} onClick={onRetry} className="shrink-0 self-start sm:self-auto">
        <RotateCw size={13} aria-hidden="true" /> Run again
      </Button>
    </div>
  );
}
