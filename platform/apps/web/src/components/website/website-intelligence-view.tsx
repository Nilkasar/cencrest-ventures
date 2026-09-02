"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { CrawlEmptyState } from "@/components/website/crawl-empty-state";
import { CrawlProgressPanel } from "@/components/website/crawl-progress-panel";
import { CrawlFailedPanel } from "@/components/website/crawl-failed-panel";
import { CrawlHistoryTable } from "@/components/website/crawl-history";
import { PageIssuesList } from "@/components/website/page-issues-list";
import { useCrawlJob } from "@/hooks/use-crawl-job";
import { useAsyncData } from "@/lib/use-async-data";
import { listCrawlJobs } from "@/data/website/client";
import { crawlBrand } from "@/data/website/fixtures";
import { formatDateTime } from "@/lib/format";

function OverviewSkeleton() {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-48" />
        <div className="flex flex-col gap-3 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function WebsiteIntelligenceView() {
  const brandId = crawlBrand.id;
  const { state, starting, start, reload } = useCrawlJob(brandId);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);

  const historyDep = state.status === "ready" ? state.progress.job.status : state.status;
  const history = useAsyncData(() => listCrawlJobs(brandId), [brandId, historyDep]);

  async function handleStart() {
    setViewingJobId(null);
    await start();
  }

  const latestJob = state.status === "ready" ? state.progress.job : null;
  const latestIsInFlight = latestJob !== null && (latestJob.status === "pending" || latestJob.status === "running");
  const canRecrawl = latestJob !== null && !latestIsInFlight;
  const effectiveViewingJobId = viewingJobId ?? latestJob?.id ?? null;
  const viewingLatest = effectiveViewingJobId === latestJob?.id;
  const showIssuesList = effectiveViewingJobId !== null && (!latestIsInFlight || !viewingLatest);

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Website Intelligence"
        description={`Crawled technical health for ${crawlBrand.websiteUrl.replace(/^https?:\/\//, "")} — page-level issues an AI model or search crawler would trip over.`}
        actions={
          canRecrawl ? (
            <Button variant="outline" size="sm" loading={starting} onClick={handleStart}>
              <RefreshCw size={14} /> Re-crawl
            </Button>
          ) : undefined
        }
      />

      {state.status === "loading" && <OverviewSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "empty" && <CrawlEmptyState websiteUrl={crawlBrand.websiteUrl} starting={starting} onStart={handleStart} />}

      {state.status === "ready" && (
        <div className="flex flex-col gap-6">
          {(state.progress.job.status === "pending" || state.progress.job.status === "running") && (
            <CrawlProgressPanel progress={state.progress} />
          )}

          {state.progress.job.status === "failed" && (
            <CrawlFailedPanel job={state.progress.job} retrying={starting} onRetry={handleStart} />
          )}

          {state.progress.job.status === "completed" && viewingLatest && (
            <p className="text-[13px] text-muted-foreground">
              Finished {state.progress.job.completedAt ? formatDateTime(state.progress.job.completedAt) : ""} —{" "}
              {state.progress.job.pagesCrawled} pages crawled.
            </p>
          )}

          {!viewingLatest && effectiveViewingJobId && (
            <p className="text-[12.5px] text-muted-foreground">
              Viewing results from a previous crawl.{" "}
              <button
                type="button"
                className="text-accent underline-offset-4 hover:underline"
                onClick={() => setViewingJobId(null)}
              >
                Back to latest
              </button>
            </p>
          )}

          {showIssuesList && effectiveViewingJobId && <PageIssuesList brandId={brandId} jobId={effectiveViewingJobId} />}

          {history.status === "success" && history.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Crawl history</CardTitle>
              </CardHeader>
              <CardContent>
                <CrawlHistoryTable
                  jobs={history.data}
                  viewingJobId={effectiveViewingJobId ?? ""}
                  onView={(jobId) => setViewingJobId(jobId)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
