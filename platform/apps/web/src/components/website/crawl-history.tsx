"use client";

import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import type { CrawlJob } from "@/data/website/types";
import { STATUS_LABEL } from "@/data/website/fixtures";
import { formatDateTime } from "@/lib/format";

const STATUS_BADGE_VARIANT: Record<CrawlJob["status"], "neutral" | "accent" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Past crawls for this site — per the epic's end-to-end flow step 5:
 * "re-crawl the same site... a new `crawl_jobs` row is created (history
 * preserved), not an overwrite of the previous crawl's pages." Each
 * completed or failed run stays viewable here, not just the latest one.
 */
export function CrawlHistoryTable({ jobs, viewingJobId, onView }: { jobs: CrawlJob[]; viewingJobId: string; onView: (jobId: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Pages</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const isViewing = job.id === viewingJobId;
          const hasResults = job.status === "completed" || job.status === "failed";
          return (
            <TableRow key={job.id}>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[job.status]} size="sm">
                  {STATUS_LABEL[job.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-[12.5px] text-foreground">{job.startedAt ? formatDateTime(job.startedAt) : "—"}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-[12.5px] text-muted-foreground">{formatDuration(job.startedAt, job.completedAt)}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-[12.5px] text-foreground">
                  {job.pagesCrawled}
                  {job.pagesFound ? ` / ${job.pagesFound}` : ""}
                </span>
              </TableCell>
              <TableCell>
                {hasResults && (
                  <Button variant={isViewing ? "secondary" : "ghost"} size="sm" onClick={() => onView(job.id)} disabled={isViewing}>
                    {isViewing ? "Viewing" : "View results"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
