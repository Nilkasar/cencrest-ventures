"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import type { CrawlJob } from "@/data/website/types";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { CrawlStatusBadge, hostOf } from "./status-badges";

/**
 * Real crawl status — not a generic spinner. Two named phases (queued,
 * then fetching pages with live counters), because that is the actual
 * granularity the crawl pipeline reports: `engine.ts`'s `updateProgress`
 * only writes `status` plus `pages_crawled`/`pages_found`/`pages_failed`,
 * polled by `useCrawlJob`. No invented phases, no "just fetched" URL.
 */
export function CrawlProgressPanel({ job }: { job: CrawlJob }) {
  const queued = job.status === "queued";
  const pct = job.progressPct ?? (job.pagesFound > 0 ? Math.min(100, Math.round((job.pagesCrawled / job.pagesFound) * 100)) : 0);

  return (
    <Section
      title={`Crawling ${hostOf(job.rootUrl)}`}
      description={
        job.startedAt
          ? `Started ${formatRelativeTime(job.startedAt)}. You can leave this page — it keeps running and results appear here when it's done.`
          : "You can leave this page — it keeps running and results appear here when it's done."
      }
      actions={<CrawlStatusBadge status={job.status} size="md" />}
    >
      <ol role="status" aria-live="polite" aria-label="Crawl progress" className="flex flex-col">
        <Step state={queued ? "active" : "done"} title="Queued" body="Waiting for a crawl slot to free up." last={false} />
        <Step
          state={queued ? "pending" : "active"}
          title="Fetching pages"
          body="Requesting each page at up to 2 requests a second, extracting titles, headings and structured data, and checking for issues as it goes."
          last
        >
          {!queued && (
            <div className="mt-3 flex flex-col gap-3">
              <div
                role="progressbar"
                aria-label="Pages fetched"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={`${job.pagesCrawled} of about ${job.pagesFound || "unknown"} pages fetched`}
                className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-2">
                <Counter label="Fetched" value={formatNumber(job.pagesCrawled)} />
                <Counter label="Discovered" value={job.pagesFound ? `~${formatNumber(job.pagesFound)}` : "—"} />
                <Counter label="Failed" value={formatNumber(job.pagesFailed)} tone={job.pagesFailed > 0 ? "danger" : undefined} />
              </dl>
            </div>
          )}
        </Step>
      </ol>
    </Section>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <dt className={typography.eyebrow}>{label}</dt>
      <dd className={cn("mt-0.5 font-mono text-[15px] font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-foreground")}>{value}</dd>
    </div>
  );
}

function Step({
  state,
  title,
  body,
  last,
  children,
}: {
  state: "done" | "active" | "pending";
  title: string;
  body: string;
  last: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepIcon state={state} />
        {!last && <div className={cn("my-0.5 w-px min-h-[24px] flex-1", state === "done" ? "bg-accent" : "bg-border")} aria-hidden="true" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-5")}>
        <p className={cn("text-[13.5px] font-medium", state === "pending" ? "text-muted-foreground" : "text-foreground")}>
          {title}
          <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : " (not started)"}</span>
        </p>
        <p className={`${typography.meta} mt-0.5 max-w-[60ch] leading-relaxed`}>{body}</p>
        {children}
      </div>
    </li>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-muted text-accent" aria-hidden="true">
        <Check size={14} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-accent-foreground" aria-hidden="true">
        <Loader2 size={14} className="animate-[spin_0.9s_linear_infinite] motion-reduce:animate-none" />
      </span>
    );
  }
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface" aria-hidden="true" />;
}
