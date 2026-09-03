"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Pagination, Skeleton } from "@bebest/ui";
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
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { currentOrganization } from "@/data/fixtures";
import { formatDateTime } from "@/lib/format";

const HISTORY_PAGE_SIZE = 10;

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

/**
 * Post-verification fix: this used to key everything off `crawlBrand` — a
 * small, self-contained fixture with a hardcoded fake website URL, entirely
 * disconnected from whatever the org actually onboarded in Epic 2 — because
 * this epic had no live backend to read a real brand from yet (see the old
 * `data/website/fixtures.ts`'s "Why not read the real brand profile"
 * section). Epic 2's frontend is wired to the real `apps/api` brand routes
 * now, and so is this epic's crawl data (`data/website/client.ts`), so this
 * view reads the real website URL via `useBrandProfile` — the same hook
 * `components/settings/brand-profile-panel.tsx` already uses — instead of a
 * fixture that would show the wrong domain for every real organization.
 */
export function WebsiteIntelligenceView() {
  const organizationId = currentOrganization.id;
  const { profile, loading: profileLoading } = useBrandProfile(organizationId);
  const { state, starting, start, reload } = useCrawlJob(organizationId);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const historyDep = state.status === "ready" ? state.job.status : state.status;
  const history = useAsyncData(
    () => listCrawlJobs({ limit: HISTORY_PAGE_SIZE, offset: (historyPage - 1) * HISTORY_PAGE_SIZE }),
    [organizationId, historyDep, historyPage],
  );

  async function handleStart() {
    setViewingJobId(null);
    setHistoryPage(1);
    await start();
  }

  const latestJob = state.status === "ready" ? state.job : null;
  const latestIsInFlight = latestJob !== null && (latestJob.status === "queued" || latestJob.status === "running");
  const canRecrawl = latestJob !== null && !latestIsInFlight;
  const effectiveViewingJobId = viewingJobId ?? latestJob?.id ?? null;
  const viewingLatest = effectiveViewingJobId === latestJob?.id;
  const showIssuesList = effectiveViewingJobId !== null && (!latestIsInFlight || !viewingLatest);

  const websiteUrl = profile?.brand.websiteUrl || "your website";
  const websiteHost = websiteUrl.replace(/^https?:\/\//, "");

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Website Intelligence"
        description={`Crawled technical health for ${websiteHost} — page-level issues an AI model or search crawler would trip over.`}
        actions={
          canRecrawl ? (
            <Button variant="outline" size="sm" loading={starting} onClick={handleStart}>
              <RefreshCw size={14} /> Re-crawl
            </Button>
          ) : undefined
        }
      />

      {(state.status === "loading" || (state.status === "empty" && profileLoading)) && <OverviewSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "empty" && !profileLoading && (
        <CrawlEmptyState websiteUrl={websiteUrl} starting={starting} onStart={handleStart} />
      )}

      {state.status === "ready" && (
        <div className="flex flex-col gap-6">
          {(state.job.status === "queued" || state.job.status === "running") && <CrawlProgressPanel job={state.job} />}

          {state.job.status === "failed" && <CrawlFailedPanel job={state.job} retrying={starting} onRetry={handleStart} />}

          {state.job.status === "completed" && viewingLatest && (
            <p className="text-[13px] text-muted-foreground">
              Finished {state.job.completedAt ? formatDateTime(state.job.completedAt) : ""} — {state.job.pagesCrawled} pages
              crawled.
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

          {showIssuesList && effectiveViewingJobId && <PageIssuesList jobId={effectiveViewingJobId} />}

          {history.status === "success" && history.data.crawlJobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Crawl history</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <CrawlHistoryTable
                  jobs={history.data.crawlJobs}
                  viewingJobId={effectiveViewingJobId ?? ""}
                  onView={(jobId) => setViewingJobId(jobId)}
                />
                <Pagination
                  page={historyPage}
                  pageSize={HISTORY_PAGE_SIZE}
                  total={history.data.pagination.total}
                  onPageChange={setHistoryPage}
                  itemLabel="past crawls"
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
