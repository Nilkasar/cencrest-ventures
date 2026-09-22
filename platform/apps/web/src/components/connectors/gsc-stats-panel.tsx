"use client";

import { Card, CardContent, Skeleton } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getGSCStats } from "@/data/connectors/client";

function fmtShort(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function fmtPct(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(n);
}

function fmtPos(n: number): string {
  return n.toFixed(1);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-subtle-foreground">{label}</p>
      <p className="font-mono text-[22px] font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function TableSection<T extends Record<string, string | number>>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: { key: keyof T; label: string; format?: (v: T[keyof T]) => string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold font-mono uppercase tracking-[0.1em] text-subtle-foreground">{title}</p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-surface">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-3 py-2 text-foreground font-mono tabular-nums truncate max-w-[200px]">
                    {col.format ? col.format(row[col.key]) : String(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GSCStatsPanel() {
  const { reload, ...state } = useAsyncData(() => getGSCStats(28), []);

  if (state.status === "loading") {
    return (
      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-40 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <CardContent className="p-5">
          <ErrorPanel message={state.error.message} onRetry={reload} compact />
        </CardContent>
      </Card>
    );
  }

  const { summary, topQueries, topPages } = state.data;

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-5">
        <p className="text-[11px] font-mono font-medium uppercase tracking-[0.1em] text-subtle-foreground">
          Last 28 days · Google Search Console
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Clicks" value={fmtShort(summary.totalClicks)} />
          <MetricCard label="Impressions" value={fmtShort(summary.totalImpressions)} />
          <MetricCard label="Avg CTR" value={fmtPct(summary.avgCtr)} />
          <MetricCard label="Avg Position" value={fmtPos(summary.avgPosition)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <TableSection
            title="Top Queries"
            rows={topQueries}
            columns={[
              { key: "query", label: "Query" },
              { key: "clicks", label: "Clicks", format: (v) => fmtShort(v as number) },
              { key: "ctr", label: "CTR", format: (v) => fmtPct(v as number) },
              { key: "position", label: "Pos", format: (v) => fmtPos(v as number) },
            ]}
          />
          <TableSection
            title="Top Pages"
            rows={topPages}
            columns={[
              { key: "page", label: "Page" },
              { key: "clicks", label: "Clicks", format: (v) => fmtShort(v as number) },
              { key: "ctr", label: "CTR", format: (v) => fmtPct(v as number) },
              { key: "position", label: "Pos", format: (v) => fmtPos(v as number) },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
}
