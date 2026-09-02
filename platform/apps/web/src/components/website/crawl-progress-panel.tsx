"use client";

import { Check, Loader2 } from "lucide-react";
import { Badge, Card, CardContent, cn } from "@bebest/ui";
import type { CrawlJob } from "@/data/website/types";
import { STATUS_LABEL } from "@/data/website/labels";
import { formatRelativeTime } from "@/lib/format";

/**
 * Real crawl status — per the epic's UI surface note: "not a generic
 * spinner." Two named phases (queued, then fetching pages with live
 * counters), because that's the actual granularity the real crawl pipeline
 * reports.
 *
 * Post-verification fix: this used to render a synthesized six-step
 * timeline (queued → validating → discovering → crawling → analyzing →
 * finalizing) derived from elapsed time against a fake, fixed 26-second
 * schedule — there was never a real signal behind the middle four steps.
 * `apps/api/src/lib/crawler/engine.ts`'s `updateProgress` only ever writes
 * `status` plus `pages_crawled`/`pages_found`/`pages_failed`, incrementally,
 * as it runs — so this panel now renders exactly that, live, from
 * `GET /crawl-jobs/:id` (`useCrawlJob`'s poll loop), instead of inventing
 * phases the backend has no way to report. The "just fetched: <url>" line
 * is gone for the same reason — no endpoint returns the URL a job most
 * recently fetched.
 */
export function CrawlProgressPanel({ job }: { job: CrawlJob }) {
  const queued = job.status === "queued";
  const pct = job.progressPct ?? (job.pagesFound > 0 ? Math.min(100, Math.round((job.pagesCrawled / job.pagesFound) * 100)) : 0);

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
          <li className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon active={queued} done={!queued} />
              <div className={cn("w-px flex-1 min-h-[28px] my-0.5", !queued ? "bg-accent" : "bg-border")} aria-hidden="true" />
            </div>
            <div className="pb-6">
              <p className={cn("text-[13.5px] font-medium", queued ? "text-foreground" : "text-muted-foreground")}>Queued</p>
              <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-[52ch]">Waiting for a crawl slot to free up.</p>
            </div>
          </li>

          <li className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon active={!queued} done={false} />
            </div>
            <div>
              <p className={cn("text-[13.5px] font-medium", queued ? "text-muted-foreground" : "text-foreground")}>Fetching pages</p>
              <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-[52ch]">
                Requesting each page at up to 2 requests/second, extracting titles, headings, structured data, and checking for
                issues as it goes.
              </p>
              {!queued && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-3 font-mono text-[12px] text-foreground">
                    <span>
                      {job.pagesCrawled} of ~{job.pagesFound || "?"} pages fetched
                    </span>
                    {job.pagesFailed > 0 && <span className="text-danger">{job.pagesFailed} failed</span>}
                  </div>
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                      style={{ width: `${pct}%` }}
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
