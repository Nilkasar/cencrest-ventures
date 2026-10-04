"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertOctagon, ArrowUpRight, CheckCircle2, FileStack, FileWarning, ListChecks } from "lucide-react";
import {
  Button,
  EmptyState,
  Pagination,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  easings,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { NoResults, SectionSkeleton } from "@/components/patterns/states";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar, ToolbarSearch } from "@/components/patterns/toolbar";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { SrTable } from "@/components/overview/primitives";
import { useAsyncData } from "@/lib/use-async-data";
import { getPageIssues } from "@/data/website/client";
import type { CrawlJob, IssueSeverity, IssueType, PageIssueWithPage } from "@/data/website/types";
import { ISSUE_TYPE_LABEL, SEVERITY_LABEL } from "@/data/website/labels";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { SEVERITIES, SEVERITY_FILL, SeverityBadge, formatCrawlDuration } from "./status-badges";

const PAGE_SIZE = 25;
const TOP_TYPES = 8;

const COLUMNS: SkeletonColumn[] = [
  { header: "Issue", cell: "entity" },
  { header: "Severity", cell: "badge" },
  { header: "Page", cell: "text" },
  { header: "Crawled", cell: "meta" },
];

type SeverityCounts = Record<IssueSeverity, number>;

interface TypeRow {
  type: IssueType;
  total: number;
  bySeverity: SeverityCounts;
}

/**
 * Everything one crawl found, organised around the job on this page:
 * "what's broken, how bad, and where do I start?"
 *
 *   1. Headline numbers (pages crawled, issues, high-severity, pages hit).
 *   2. Where it concentrates — issue types ranked by count, and the
 *      severity mix. Both are filters: click a bar to narrow the table.
 *   3. The issue table itself, searchable and filterable.
 *
 * `getPageIssues` already fetches every page of the crawl (≤500) to count
 * issues client-side, so this calls it once per job and does severity /
 * type / search / pagination locally — every filter change is instant
 * instead of re-downloading the whole crawl.
 */
export function PageIssuesList({ jobId, job }: { jobId: string; job: CrawlJob | null }) {
  const { reload, ...state } = useAsyncData(() => getPageIssues(jobId), [jobId]);

  const [severity, setSeverity] = useState<IssueSeverity | "all">("all");
  const [type, setType] = useState<IssueType | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [showAllTypes, setShowAllTypes] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(searchInput.trim().toLowerCase());
      setPage(1);
    }, 150);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const issues = useMemo(() => (state.status === "success" ? state.data.issues : null), [state]);
  const bySeverity: SeverityCounts | null = state.status === "success" ? state.data.bySeverity : null;
  const total = state.status === "success" ? state.data.total : 0;

  const typeRows = useMemo<TypeRow[]>(() => {
    if (!issues) return [];
    const map = new Map<IssueType, TypeRow>();
    for (const issue of issues) {
      const row = map.get(issue.issueType) ?? { type: issue.issueType, total: 0, bySeverity: { high: 0, medium: 0, low: 0 } };
      row.total++;
      row.bySeverity[issue.severity]++;
      map.set(issue.issueType, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || ISSUE_TYPE_LABEL[a.type].localeCompare(ISSUE_TYPE_LABEL[b.type]));
  }, [issues]);

  const pagesWithIssues = useMemo(() => (issues ? new Set(issues.map((i) => i.page.id)).size : 0), [issues]);

  const filtered = useMemo(() => {
    if (!issues) return [];
    return issues.filter((issue) => {
      if (severity !== "all" && issue.severity !== severity) return false;
      if (type !== "all" && issue.issueType !== type) return false;
      if (q) {
        const haystack = `${ISSUE_TYPE_LABEL[issue.issueType]} ${issue.detail ?? ""} ${issue.page.url} ${issue.page.title ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [issues, severity, type, q]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = severity !== "all" || type !== "all" || q !== "";

  function clearFilters() {
    setSeverity("all");
    setType("all");
    setSearchInput("");
    setQ("");
    setPage(1);
  }

  function pickSeverity(next: IssueSeverity | "all") {
    setSeverity((cur) => (cur === next ? "all" : next));
    setPage(1);
  }

  function pickType(next: IssueType) {
    setType((cur) => (cur === next ? "all" : next));
    setPage(1);
  }

  const severityOptions = [
    { value: "all" as const, label: "All severities" },
    ...SEVERITIES.map((s) => ({ value: s, label: bySeverity ? `${SEVERITY_LABEL[s]} (${bySeverity[s]})` : SEVERITY_LABEL[s] })),
  ];
  const typeOptions = [
    { value: "all" as const, label: "All issue types" },
    ...typeRows.map((r) => ({ value: r.type, label: `${ISSUE_TYPE_LABEL[r.type]} (${r.total})` })),
  ];

  const loading = state.status === "loading";
  const duration = job ? formatCrawlDuration(job.startedAt, job.completedAt) : null;
  const crawledPages = job?.pagesCrawled ?? null;

  if (state.status === "error") {
    return <ErrorPanel title="Crawl results didn't load" message={state.error.message} onRetry={reload} />;
  }

  return (
    <>
      <StatGrid>
        <StatTile
          label="Pages crawled"
          icon={<FileStack size={13} />}
          value={crawledPages !== null ? formatNumber(crawledPages) : "—"}
          muted={crawledPages === null}
          hint={
            job?.completedAt
              ? `${formatDate(job.completedAt)}${duration ? ` · took ${duration}` : ""}`
              : job?.pagesFailed
                ? `${formatNumber(job.pagesFailed)} failed to load`
                : "In this crawl"
          }
        />
        <StatTile
          label="Issues found"
          icon={<ListChecks size={13} />}
          loading={loading}
          value={formatNumber(total)}
          hint={typeRows.length ? `Across ${typeRows.length} issue type${typeRows.length === 1 ? "" : "s"}` : "Nothing flagged"}
        />
        <StatTile
          label="High severity"
          icon={<AlertOctagon size={13} />}
          loading={loading}
          value={bySeverity ? formatNumber(bySeverity.high) : "—"}
          hint={bySeverity && bySeverity.high > 0 ? "Fix these first" : "None blocking crawlers"}
        />
        <StatTile
          label="Pages with issues"
          icon={<FileWarning size={13} />}
          loading={loading}
          value={formatNumber(pagesWithIssues)}
          hint={crawledPages ? `${formatPercent((pagesWithIssues / crawledPages) * 100)} of crawled pages` : "Distinct URLs flagged"}
        />
      </StatGrid>

      {loading && (
        <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <SectionSkeleton lines={6} className="lg:col-span-7" titleWidth="w-40" />
          <SectionSkeleton lines={4} className="lg:col-span-5" titleWidth="w-28" />
        </Reveal>
      )}

      {issues && total === 0 && (
        <Reveal>
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title="No issues found"
            description={`This crawl found nothing a search or AI crawler would trip over${crawledPages ? ` across ${formatNumber(crawledPages)} pages` : ""}. Next, score your content quality and keyword coverage.`}
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/seo-intelligence">Open SEO Intelligence</Link>
              </Button>
            }
          />
        </Reveal>
      )}

      {issues && total > 0 && bySeverity && (
        <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
          <Section
            className="lg:col-span-7"
            title="Most common issues"
            description="Ranked by how many times each appears. Select one to filter the list below."
          >
            <ul className="flex flex-col gap-1">
              {(showAllTypes ? typeRows : typeRows.slice(0, TOP_TYPES)).map((row, i) => (
                <li key={row.type}>
                  <TypeBar row={row} max={typeRows[0]!.total} index={i} active={type === row.type} onSelect={() => pickType(row.type)} />
                </li>
              ))}
            </ul>
            {typeRows.length > TOP_TYPES && (
              <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setShowAllTypes((v) => !v)} aria-expanded={showAllTypes}>
                {showAllTypes ? "Show fewer" : `Show all ${typeRows.length} issue types`}
              </Button>
            )}
            <SrTable
              caption="Issues by type and severity"
              head={["Issue type", "Total", "High", "Medium", "Low"]}
              rows={typeRows.map((r) => [ISSUE_TYPE_LABEL[r.type], r.total, r.bySeverity.high, r.bySeverity.medium, r.bySeverity.low])}
            />
          </Section>

          <Section className="lg:col-span-5" title="Severity" description="How much of this is urgent. Select a level to filter.">
            <SeverityMix counts={bySeverity} total={total} active={severity} onSelect={pickSeverity} />
          </Section>
        </div>
      )}

      {issues && total > 0 && (
        <Toolbar end={<ResultCount count={filtered.length} noun="issue" />}>
          <ToolbarSearch value={searchInput} onChange={setSearchInput} placeholder="Search issue, page or URL" label="Search issues" />
          <FilterSelect
            value={severity}
            onValueChange={(v) => {
              setSeverity(v);
              setPage(1);
            }}
            options={severityOptions}
            label="Filter by severity"
          />
          <FilterSelect
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={typeOptions}
            label="Filter by issue type"
            className="sm:w-56"
          />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {loading && <TableSkeleton columns={COLUMNS} label="Loading issues…" />}

        {issues && total > 0 && filtered.length === 0 && (
          <NoResults noun="issues" onClear={clearFilters} hint="Try a different severity, issue type, or search term." />
        )}

        {issues && filtered.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Crawled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="issues" />
          </RefreshOverlay>
        )}
      </Reveal>
    </>
  );
}

function IssueRow({ issue }: { issue: PageIssueWithPage }) {
  return (
    <TableRow>
      <TableCell className="max-w-[340px]">
        <p className="text-[13px] font-medium text-foreground">{ISSUE_TYPE_LABEL[issue.issueType]}</p>
        {issue.detail && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">{issue.detail}</p>}
      </TableCell>
      <TableCell>
        <SeverityBadge severity={issue.severity} />
      </TableCell>
      <TableCell className="max-w-[300px]">
        <p className="truncate text-[13px] text-foreground">{issue.page.title || <span className="text-muted-foreground">Untitled page</span>}</p>
        <a
          href={issue.page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-[11.5px] text-muted-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{issue.page.url.replace(/^https?:\/\//, "")}</span>
          <ArrowUpRight size={11} className="shrink-0 opacity-60 group-hover:opacity-100" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </TableCell>
      <TableCell>
        {/* The API has no per-issue timestamp — the page's own `crawledAt`
            is the closest real signal for "when this was found." */}
        <span className={`${typography.meta} whitespace-nowrap`} title={formatDateTime(issue.page.crawledAt)}>
          {formatDate(issue.page.crawledAt)}
        </span>
      </TableCell>
    </TableRow>
  );
}

/** One ranked issue type: label, a bar split by severity, the count. */
function TypeBar({ row, max, index, active, onSelect }: { row: TypeRow; max: number; index: number; active: boolean; onSelect: () => void }) {
  const width = max > 0 ? (row.total / max) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "grid w-full grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.75rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3rem]",
        "hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent-muted/50 hover:bg-accent-muted/60",
      )}
    >
      <span className={cn("truncate text-[13px]", active ? "font-medium text-foreground" : "text-foreground")}>{ISSUE_TYPE_LABEL[row.type]}</span>
      <span className="relative h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <motion.span
          className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
          style={{ width: `${width}%`, originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, delay: 0.15 + index * 0.04, ease: easings.emphasized }}
        >
          {SEVERITIES.map((s) =>
            row.bySeverity[s] > 0 ? <span key={s} className={cn("h-full", SEVERITY_FILL[s])} style={{ width: `${(row.bySeverity[s] / row.total) * 100}%` }} /> : null,
          )}
        </motion.span>
      </span>
      <span className="text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground">{formatNumber(row.total)}</span>
    </button>
  );
}

/** The severity split as one proportional bar plus a selectable legend. */
function SeverityMix({
  counts,
  total,
  active,
  onSelect,
}: {
  counts: SeverityCounts;
  total: number;
  active: IssueSeverity | "all";
  onSelect: (s: IssueSeverity) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {SEVERITIES.map((s, i) =>
          counts[s] > 0 ? (
            <motion.span
              key={s}
              className={cn("h-full first:rounded-l-full last:rounded-r-full", SEVERITY_FILL[s])}
              style={{ width: `${(counts[s] / total) * 100}%`, originX: 0 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.08, ease: easings.emphasized }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {SEVERITIES.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              aria-pressed={active === s}
              disabled={counts[s] === 0}
              className={cn(
                "flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left transition-colors",
                "hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
                active === s && "bg-accent-muted/50 hover:bg-accent-muted/60",
              )}
            >
              <span className={cn("size-2.5 shrink-0 rounded-full", SEVERITY_FILL[s])} aria-hidden="true" />
              <span className="flex-1 text-[13px] text-foreground">{SEVERITY_LABEL[s]}</span>
              <span className={`${typography.meta} tabular-nums`}>{formatPercent((counts[s] / total) * 100)}</span>
              <span className="w-12 text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground">{formatNumber(counts[s])}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
