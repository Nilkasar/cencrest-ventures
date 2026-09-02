"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@bebest/ui";
import type { CrawlJob } from "@/data/website/types";
import { formatDateTime } from "@/lib/format";

/**
 * A crawl that stopped partway — per the epic's end-to-end flow step 3:
 * "the job records a clear per-page error rather than crashing the whole
 * job." The message names what actually happened (an SSRF-guard rejection,
 * in this fixture) and how far the job got, rather than a bare "crawl
 * failed." Pages fetched before the failure are still real results — the
 * caller renders them below this panel, not instead of it.
 */
export function CrawlFailedPanel({ job, retrying, onRetry }: { job: CrawlJob; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-muted px-6 py-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-display text-[15px] font-semibold text-foreground">Crawl stopped before finishing</p>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-[64ch]">{job.error}</p>
          {job.completedAt && (
            <p className="text-[12px] text-subtle-foreground mt-1.5">Stopped {formatDateTime(job.completedAt)}</p>
          )}
        </div>
      </div>
      <div>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
          Start a new crawl
        </Button>
      </div>
    </div>
  );
}
