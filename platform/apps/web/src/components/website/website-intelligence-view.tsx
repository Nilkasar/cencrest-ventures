"use client";

import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Button, Card } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { SectionSkeleton } from "@/components/patterns/states";
import { TableSkeleton } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { CrawlEmptyState } from "@/components/website/crawl-empty-state";
import { CrawlProgressPanel } from "@/components/website/crawl-progress-panel";
import { CrawlFailedPanel } from "@/components/website/crawl-failed-panel";
import { CrawlHistorySection } from "@/components/website/crawl-history";
import { PageIssuesList } from "@/components/website/page-issues-list";
import { useCrawlJob } from "@/hooks/use-crawl-job";
import { useAsyncData } from "@/lib/use-async-data";
import { listCrawlJobs } from "@/data/website/client";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useCurrentOrg } from "@/lib/session-context";
import { formatDateTime } from "@/lib/format";
import { hostOf } from "./status-badges";

const HISTORY_PAGE_SIZE = 10;

/**
 * Website Intelligence — "Can search engines and AI read my site, and what
 * do I fix first?" Reads the org's real website URL via `useBrandProfile`
 * and the real crawl pipeline via `useCrawlJob` (latest job + live poll)
 * and `listCrawlJobs` (history).
 *
 * Layout, top to bottom: live crawl progress or a failure notice when
 * relevant → the viewed crawl's headline numbers → where issues
 * concentrate (by type, by severity — both act as filters) → the issue
 * table → crawl history.
 */
export function WebsiteIntelligenceView() {
  const org = useCurrentOrg();
  const organizationId = org?.id ?? "";
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

  const historyJobs = history.status === "success" ? history.data.crawlJobs : [];
  const viewingJob = viewingLatest ? latestJob : (historyJobs.find((j) => j.id === effectiveViewingJobId) ?? null);

  const websiteUrl = profile?.brand.websiteUrl || "your website";
  const websiteHost = profile?.brand.websiteUrl ? hostOf(profile.brand.websiteUrl) : null;

  const showSkeleton = state.status === "loading" || (state.status === "empty" && profileLoading);

  return (
    <>
      <PageHeader
        title="Website Intelligence"
        description={
          websiteHost
            ? `What a search or AI crawler trips over on ${websiteHost} — page-level issues from your latest crawl, ranked so you know what to fix first.`
            : "What a search or AI crawler trips over on your site — page-level issues from your latest crawl, ranked so you know what to fix first."
        }
        meta={
          latestJob?.completedAt && latestJob.status === "completed" ? (
            <span className={typography.meta}>Last crawled {formatDateTime(latestJob.completedAt)}</span>
          ) : undefined
        }
        actions={
          canRecrawl ? (
            <Button variant="outline" size="sm" loading={starting} onClick={handleStart}>
              <RefreshCw size={14} aria-hidden="true" /> Re-crawl
            </Button>
          ) : undefined
        }
      />

      {showSkeleton && (
        <PageStack>
          <StatGrid>
            {["Pages crawled", "Issues found", "High severity", "Pages with issues"].map((label) => (
              <StatTile key={label} label={label} value="—" loading />
            ))}
          </StatGrid>
          <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <SectionSkeleton lines={6} className="lg:col-span-7" titleWidth="w-40" />
            <SectionSkeleton lines={4} className="lg:col-span-5" titleWidth="w-28" />
          </Reveal>
          <Reveal>
            <TableSkeleton
              columns={[
                { header: "Issue", cell: "entity" },
                { header: "Severity", cell: "badge" },
                { header: "Page", cell: "text" },
                { header: "Crawled", cell: "meta" },
              ]}
              label="Loading crawl results…"
            />
          </Reveal>
        </PageStack>
      )}

      {state.status === "error" && <ErrorPanel title="Crawl status didn't load" message={state.error.message} onRetry={reload} />}

      {state.status === "empty" && !profileLoading && <CrawlEmptyState websiteUrl={websiteUrl} starting={starting} onStart={handleStart} />}

      {state.status === "ready" && (
        <PageStack>
          {latestIsInFlight && <CrawlProgressPanel job={state.job} />}

          {state.job.status === "failed" && viewingLatest && <CrawlFailedPanel job={state.job} retrying={starting} onRetry={handleStart} />}

          {!viewingLatest && effectiveViewingJobId && (
            <Reveal>
              <Card className="flex flex-col gap-3 border-info/30 bg-info-muted/40 px-4 py-3 sm:flex-row sm:items-center">
                <History size={15} className="hidden shrink-0 text-info sm:block" aria-hidden="true" />
                <p className="flex-1 text-[13px] text-foreground" role="status">
                  Viewing an earlier crawl
                  {viewingJob?.startedAt ? <span className="text-muted-foreground"> from {formatDateTime(viewingJob.startedAt)}</span> : null}.
                </p>
                <Button variant="outline" size="sm" onClick={() => setViewingJobId(null)} className="self-start sm:self-auto">
                  Back to latest
                </Button>
              </Card>
            </Reveal>
          )}

          {showIssuesList && effectiveViewingJobId && <PageIssuesList key={effectiveViewingJobId} jobId={effectiveViewingJobId} job={viewingJob} />}

          {history.status === "success" && historyJobs.length > 0 && (
            <CrawlHistorySection
              jobs={historyJobs}
              total={history.data.pagination.total}
              page={historyPage}
              pageSize={HISTORY_PAGE_SIZE}
              onPageChange={setHistoryPage}
              refreshing={history.isRefreshing}
              viewingJobId={effectiveViewingJobId ?? ""}
              onView={(jobId) => {
                setViewingJobId(jobId);
                window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              }}
            />
          )}

          {history.status === "error" && (
            <Reveal>
              <ErrorPanel compact title="Crawl history didn't load" message={history.error.message} onRetry={history.reload} />
            </Reveal>
          )}
        </PageStack>
      )}
    </>
  );
}
