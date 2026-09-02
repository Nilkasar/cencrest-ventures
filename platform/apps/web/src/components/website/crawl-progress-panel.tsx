"use client";

import { Check, Loader2, X } from "lucide-react";
import { Badge, Card, CardContent, cn } from "@bebest/ui";
import type { CrawlProgress, CrawlStep } from "@/data/website/types";
import { STATUS_LABEL } from "@/data/website/fixtures";
import { formatRelativeTime } from "@/lib/format";

function StepIcon({ state }: { state: CrawlStep["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-muted text-accent">
        <Check size={14} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-accent-foreground">
        <Loader2 size={14} className="animate-[spin_0.9s_linear_infinite]" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-danger bg-danger-muted text-danger">
        <X size={14} />
      </span>
    );
  }
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface" aria-hidden="true" />;
}

/**
 * Real step-by-step crawl status — per the epic's UI surface note: "not a
 * generic spinner." Every step names what's actually happening (validating
 * robots.txt, discovering the sitemap, fetching pages, analyzing for
 * issues) and the active step shows live counters, not just a percentage.
 */
export function CrawlProgressPanel({ progress }: { progress: CrawlProgress }) {
  const { job, steps, lastFetchedUrl } = progress;
  const activeIndex = steps.findIndex((s) => s.state === "active");

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col gap-1 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-[16px] font-semibold text-foreground">Crawling {job.rootUrl}</p>
            {job.startedAt && (
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Started {formatRelativeTime(job.startedAt)} — you can leave this page; it&rsquo;ll keep running.
              </p>
            )}
          </div>
          <Badge variant="accent" size="md" dot>
            {STATUS_LABEL[job.status]}
          </Badge>
        </div>

        <ol role="status" aria-live="polite" className="flex flex-col">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            return (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepIcon state={step.state} />
                  {!isLast && (
                    <div
                      className={cn(
                        "w-px flex-1 min-h-[28px] my-0.5",
                        index < Math.max(activeIndex, 0) || step.state === "done" ? "bg-accent" : "bg-border",
                      )}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className={cn("pb-6", isLast && "pb-0")}>
                  <p
                    className={cn(
                      "text-[13.5px] font-medium",
                      step.state === "pending" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-[52ch]">{step.description}</p>
                  {step.state === "active" && step.key === "crawling" && (
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 font-mono text-[12px] text-foreground">
                        <span>
                          {job.pagesCrawled} of ~{job.pagesFound || "?"} pages fetched
                        </span>
                      </div>
                      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                          style={{ width: `${job.pagesFound ? Math.min(100, (job.pagesCrawled / job.pagesFound) * 100) : 0}%` }}
                        />
                      </div>
                      {lastFetchedUrl && (
                        <p className="text-[11.5px] text-subtle-foreground truncate max-w-xs">Just fetched: {lastFetchedUrl}</p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
