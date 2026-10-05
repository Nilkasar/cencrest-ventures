"use client";

import { Button, Pagination, RefreshOverlay, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import type { CrawlJob } from "@/data/website/types";
import { formatDateTime, formatNumber } from "@/lib/format";
import { CrawlStatusBadge, formatCrawlDuration } from "./status-badges";

/**
 * Past crawls for this site. Re-crawling creates a new `crawl_jobs` row
 * (history preserved), so each completed or failed run stays viewable
 * here, not just the latest one.
 */
export function CrawlHistorySection({
  jobs,
  total,
  page,
  pageSize,
  onPageChange,
  refreshing,
  viewingJobId,
  onView,
}: {
  jobs: CrawlJob[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  refreshing: boolean;
  viewingJobId: string;
  onView: (jobId: string) => void;
}) {
  return (
    <Section title="Crawl history" description="Every crawl is kept, so you can compare what changed between runs." flush>
      <RefreshOverlay active={refreshing}>
        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const isViewing = job.id === viewingJobId;
              const hasResults = job.status === "completed" || job.status === "failed";
              return (
                <TableRow key={job.id} aria-current={isViewing ? "true" : undefined} className={isViewing ? "bg-accent-muted/30" : undefined}>
                  <TableCell>
                    <span className="text-[13px] text-foreground whitespace-nowrap">
                      {job.startedAt ? formatDateTime(job.startedAt) : formatDateTime(job.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <CrawlStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={typography.numeric}>
                      {formatNumber(job.pagesCrawled)}
                      {job.pagesFound ? <span className="text-muted-foreground"> / {formatNumber(job.pagesFound)}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={job.pagesFailed > 0 ? `${typography.numeric} text-danger` : `${typography.numeric} text-muted-foreground`}>
                      {formatNumber(job.pagesFailed)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`${typography.numeric} text-muted-foreground`}>{formatCrawlDuration(job.startedAt, job.completedAt) ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isViewing ? (
                      <span className="text-[12px] font-medium text-accent">Viewing</span>
                    ) : hasResults ? (
                      <Button variant="ghost" size="sm" onClick={() => onView(job.id)} aria-label={`View results from the crawl started ${job.startedAt ? formatDateTime(job.startedAt) : ""}`}>
                        View results
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {total > pageSize && (
          <div className="border-t border-border px-5 py-3">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} itemLabel="past crawls" />
          </div>
        )}
      </RefreshOverlay>
    </Section>
  );
}
