"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { RefreshOverlay } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SplitLayout } from "@/components/patterns/layout";
import { TrendChart } from "@/components/overview/trend-chart";
import { SrTable } from "@/components/overview/primitives";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCompactNumber, formatNumber } from "@/lib/format";
import { getGSCStats } from "@/data/connectors/client";
import {
  MetricStrip,
  MetricSwitch,
  PERIOD_DAYS,
  StatsError,
  StatsSkeleton,
  TopTable,
  TruncatedLabel,
  displayPath,
  formatPosition,
  ratioPercent,
  toTime,
} from "./stats-blocks";

type TrendKey = "clicks" | "impressions";

const TREND_OPTIONS: { key: TrendKey; label: string }[] = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
];

/**
 * "Where do I stand in search?" from the brand's own Search Console:
 * period totals, a daily trend (one measure at a time — clicks and
 * impressions differ by orders of magnitude and never share an axis), and
 * the queries and pages that earn the clicks.
 */
export function GSCStatsPanel({ onReconnect, canManage }: { onReconnect: () => void; canManage: boolean }) {
  const { reload, ...state } = useAsyncData(() => getGSCStats(PERIOD_DAYS), []);
  const [trendKey, setTrendKey] = useState<TrendKey>("clicks");

  const data = state.status === "success" ? state.data : null;

  return (
    <>
      <Section
        title="Search performance"
        description={`Google Search Console · last ${PERIOD_DAYS} days`}
        icon={<Search size={14} />}
        actions={data && data.trend.length > 0 ? <MetricSwitch value={trendKey} onChange={setTrendKey} options={TREND_OPTIONS} label="Trend metric" /> : undefined}
      >
        {state.status === "loading" && <StatsSkeleton label="Loading Search Console data…" />}
        {state.status === "error" && (
          <StatsError error={state.error} source="Search Console" onRetry={reload} onReconnect={onReconnect} canManage={canManage} />
        )}
        {data && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-5">
            <MetricStrip
              metrics={[
                { label: "Clicks", value: formatNumber(data.summary.totalClicks), hint: "From Google Search" },
                { label: "Impressions", value: formatCompactNumber(data.summary.totalImpressions), hint: "Times you appeared" },
                { label: "Avg CTR", value: ratioPercent(data.summary.avgCtr), hint: "Clicks ÷ impressions" },
                { label: "Avg position", value: formatPosition(data.summary.avgPosition), hint: "Lower is better" },
              ]}
            />
            <GscTrend trend={data.trend} metric={trendKey} />
          </RefreshOverlay>
        )}
      </Section>

      {data && (
        <SplitLayout>
          <TopTable
            title="Top queries"
            description="What people searched before clicking through"
            rows={data.topQueries}
            rowKey={(row) => row.query}
            emptyLabel="No queries recorded in this period."
            columns={[
              { header: "Query", cell: (row) => <TruncatedLabel text={row.query} /> },
              { header: "Clicks", numeric: true, cell: (row) => formatNumber(row.clicks) },
              { header: "CTR", numeric: true, cell: (row) => ratioPercent(row.ctr) },
              { header: "Pos.", numeric: true, cell: (row) => formatPosition(row.position) },
            ]}
          />
          <TopTable
            title="Top pages"
            description="Your pages that earned the most clicks"
            rows={data.topPages}
            rowKey={(row) => row.page}
            emptyLabel="No pages recorded in this period."
            columns={[
              { header: "Page", cell: (row) => <TruncatedLabel text={displayPath(row.page)} full={row.page} /> },
              { header: "Clicks", numeric: true, cell: (row) => formatNumber(row.clicks) },
              { header: "CTR", numeric: true, cell: (row) => ratioPercent(row.ctr) },
              { header: "Pos.", numeric: true, cell: (row) => formatPosition(row.position) },
            ]}
          />
        </SplitLayout>
      )}
    </>
  );
}

function GscTrend({ trend, metric }: { trend: { date: string; clicks: number; impressions: number }[]; metric: TrendKey }) {
  const label = metric === "clicks" ? "Clicks" : "Impressions";
  const points = trend.map((d) => ({ t: toTime(d.date), v: d[metric] })).sort((a, b) => a.t - b.t);

  if (points.length === 0) {
    return <p className="py-10 text-center text-[12.5px] text-muted-foreground">Google hasn&apos;t returned daily data for this period yet.</p>;
  }

  return (
    <div>
      <TrendChart
        key={metric}
        points={points}
        height={200}
        formatValue={(v) => formatCompactNumber(v)}
        ariaSummary={`Daily ${label.toLowerCase()} from Google Search over the last ${PERIOD_DAYS} days, ${points.length} days of data.`}
      />
      <SrTable
        caption={`Daily ${label.toLowerCase()}`}
        head={["Date", label]}
        rows={points.map((p) => [new Date(p.t).toLocaleDateString("en-US"), formatNumber(p.v)])}
      />
    </div>
  );
}
