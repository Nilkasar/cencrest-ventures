"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { getPageIssues } from "@/data/website/client";
import type { IssueSeverity, PageIssueWithPage } from "@/data/website/types";
import { ISSUE_TYPE_LABEL, SEVERITY_LABEL } from "@/data/website/labels";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 25;

const SEVERITY_BADGE_VARIANT: Record<IssueSeverity, NonNullable<BadgeProps["variant"]>> = {
  high: "danger",
  medium: "warning",
  low: "outline",
};

function StatCard({ label, value, variant }: { label: string; value: number; variant: "high" | "medium" | "low" | "total" }) {
  const dotClass = { high: "bg-danger", medium: "bg-warning", low: "bg-subtle-foreground", total: "bg-accent" }[variant];
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">
          <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
          {label}
        </p>
        <p className="font-mono text-[22px] font-semibold text-foreground mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function IssuesTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Severity</TableHead>
          <TableHead>Issue</TableHead>
          <TableHead>Page</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-3 w-32" /></TableCell>
            <TableCell><Skeleton className="h-3 w-48" /></TableCell>
            <TableCell><Skeleton className="h-3 w-56" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The page-issues list, grouped by severity — per the epic's UI surface.
 * The severity tabs double as the API's "filterable by issue severity"
 * query param; "Load more" mirrors the paginated response shape rather
 * than rendering every row from a 500-page crawl at once.
 */
export function PageIssuesList({ jobId }: { jobId: string }) {
  const [severity, setSeverity] = useState<IssueSeverity | "all">("all");
  const [page, setPage] = useState(1);
  const [issues, setIssues] = useState<PageIssueWithPage[]>([]);
  const [total, setTotal] = useState(0);
  const [bySeverity, setBySeverity] = useState<Record<IssueSeverity, number>>({ high: 0, medium: 0, low: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Same legitimate exception `use-async-data.ts` documents: a severity
    // or job change genuinely needs a fresh loading state before the new
    // fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getPageIssues(jobId, { severity, page: 1, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setIssues(result.issues);
        setTotal(result.total);
        setBySeverity(result.bySeverity);
        setPage(1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, severity, reloadToken]);

  function loadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    getPageIssues(jobId, { severity, page: nextPage, pageSize: PAGE_SIZE })
      .then((result) => {
        setIssues((prev) => [...prev, ...result.issues]);
        setPage(nextPage);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoadingMore(false));
  }

  const totalIssues = bySeverity.high + bySeverity.medium + bySeverity.low;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total issues" value={totalIssues} variant="total" />
        <StatCard label="High" value={bySeverity.high} variant="high" />
        <StatCard label="Medium" value={bySeverity.medium} variant="medium" />
        <StatCard label="Low" value={bySeverity.low} variant="low" />
      </div>

      <Tabs value={severity} onValueChange={(v) => setSeverity(v as IssueSeverity | "all")}>
        <TabsList>
          <TabsTrigger value="all">All ({totalIssues})</TabsTrigger>
          <TabsTrigger value="high">High ({bySeverity.high})</TabsTrigger>
          <TabsTrigger value="medium">Medium ({bySeverity.medium})</TabsTrigger>
          <TabsTrigger value="low">Low ({bySeverity.low})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading && <IssuesTableSkeleton />}

      {!loading && error && <ErrorPanel message={error.message} onRetry={() => setReloadToken((t) => t + 1)} />}

      {!loading && !error && total === 0 && (
        <EmptyState
          compact
          icon={<CheckCircle2 size={18} />}
          title={severity === "all" ? "No issues found" : `No ${SEVERITY_LABEL[severity].toLowerCase()} issues`}
          description={severity === "all" ? "This crawl came back clean." : "Try a different severity, or view all issues."}
        />
      )}

      {!loading && !error && total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Crawled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <Badge variant={SEVERITY_BADGE_VARIANT[issue.severity]} size="sm">
                      {SEVERITY_LABEL[issue.severity]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-[13px] text-foreground">{ISSUE_TYPE_LABEL[issue.issueType]}</span>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <p className="text-[13px] text-foreground truncate">{issue.page.title ?? "(untitled)"}</p>
                    <p className="font-mono text-[11.5px] text-muted-foreground truncate">{issue.page.url}</p>
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <p className="text-[12.5px] text-muted-foreground">{issue.detail}</p>
                  </TableCell>
                  <TableCell>
                    {/* The API has no per-issue timestamp (`serializePage` in
                        `routes/pages.ts` returns `{id, issueType, severity,
                        detail}` for each nested issue, nothing more) — the
                        page's own `crawledAt` is the closest real signal for
                        "when this was found." */}
                    <span className="text-[12.5px] text-muted-foreground whitespace-nowrap">{formatDate(issue.page.crawledAt)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {issues.length < total && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" loading={loadingMore} onClick={loadMore}>
                <ChevronDown size={14} /> Load {Math.min(PAGE_SIZE, total - issues.length)} more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
