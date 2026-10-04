"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button, Card } from "@bebest/ui";
import { Reveal } from "@/components/patterns/motion";
import { typography } from "@/components/patterns/typography";
import type { CrawlJob } from "@/data/website/types";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * A crawl that stopped partway. The message names what actually happened
 * (the API's own `error`) and how far the job got. Pages fetched before the
 * failure are still real results — the caller renders them below this
 * panel, not instead of it.
 */
export function CrawlFailedPanel({ job, retrying, onRetry }: { job: CrawlJob; retrying: boolean; onRetry: () => void }) {
  return (
    <Reveal>
      <Card role="alert" className="flex flex-col gap-4 border-danger/30 p-5 sm:flex-row sm:items-start">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-muted text-danger" aria-hidden="true">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={typography.sectionTitle}>The latest crawl stopped before finishing</p>
          <p className={`${typography.secondary} mt-1 max-w-[68ch]`}>{job.error ?? "The crawler didn't report a reason."}</p>
          <p className={`${typography.meta} mt-2`}>
            {formatNumber(job.pagesCrawled)} page{job.pagesCrawled === 1 ? "" : "s"} fetched before it stopped
            {job.completedAt ? ` · ${formatDateTime(job.completedAt)}` : ""}
            {job.pagesCrawled > 0 ? " — their issues are listed below." : "."}
          </p>
        </div>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry} className="shrink-0 self-start">
          <RefreshCw size={13} aria-hidden="true" /> Start a new crawl
        </Button>
      </Card>
    </Reveal>
  );
}
