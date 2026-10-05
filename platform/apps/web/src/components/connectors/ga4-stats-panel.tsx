"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { RefreshOverlay } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { SplitLayout } from "@/components/patterns/layout";
import { TrendChart } from "@/components/overview/trend-chart";
import { SrTable } from "@/components/overview/primitives";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCompactNumber, formatNumber } from "@/lib/format";
import { getGA4Stats } from "@/data/connectors/client";
import type { GA4Stats } from "@/data/connectors/types";
import {
  MetricStrip,
  MetricSwitch,
  PERIOD_DAYS,
  StatsError,
  StatsSkeleton,
  TopTable,
  TruncatedLabel,
  formatDuration,
  ratioPercent,
  toTime,
} from "./stats-blocks";

type TrendKey = "sessions" | "users" | "pageViews";

const TREND_OPTIONS: { key: TrendKey; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "users", label: "Users" },
  { key: "pageViews", label: "Page views" },
];

/**
 * The brand's own site traffic from Analytics 4: period totals, a daily
 * trend, the pages people land on, and which channels bring them.
 */
export function GA4StatsPanel({ onReconnect, canManage }: { onReconnect: () => void; canManage: boolean }) {
  const { reload, ...state } = useAsyncData(() => getGA4Stats(PERIOD_DAYS), []);
  const [trendKey, setTrendKey] = useState<TrendKey>("sessions");

  const data = state.status === "success" ? state.data : null;

  return (
    <>
      <Section
        title="Site traffic"
        description={`Google Analytics 4 · last ${PERIOD_DAYS} days`}
        icon={<BarChart3 size={14} />}
        actions={data && data.trend.length > 0 ? <MetricSwitch value={trendKey} onChange={setTrendKey} options={TREND_OPTIONS} label="Trend metric" /> : undefined}
      >
        {state.status === "loading" && <StatsSkeleton label="Loading Analytics 4 data…" />}
        {state.status === "error" && (
          <StatsError error={state.error} source="Analytics 4" onRetry={reload} onReconnect={onReconnect} canManage={canManage} />
        )}
        {data && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-5">
            <MetricStrip
              metrics={[
                { label: "Sessions", value: formatNumber(data.summary.sessions), hint: `${formatCompactNumber(data.summary.pageViews)} page views` },
                { label: "Users", value: formatNumber(data.summary.users), hint: `${formatNumber(data.summary.newUsers)} new` },
                { label: "Engagement", value: ratioPercent(data.summary.engagementRate), hint: `Bounce ${ratioPercent(data.summary.bounceRate)}` },
                { label: "Avg session", value: formatDuration(data.summary.avgSessionDurationSecs), hint: "Time on site per visit" },
              ]}
            />
            <Ga4Trend trend={data.trend} metric={trendKey} />
          </RefreshOverlay>
        )}
      </Section>

      {data && (
        <SplitLayout>
          <TopTable
            title="Top pages"
            description="Most viewed pages on your site"
            rows={data.topPages}
            rowKey={(row) => row.page}
            emptyLabel="No page views recorded in this period."
            columns={[
              { header: "Page", cell: (row) => <TruncatedLabel text={row.page} /> },
              { header: "Views", numeric: true, cell: (row) => formatNumber(row.pageViews) },
              { header: "Sessions", numeric: true, cell: (row) => formatNumber(row.sessions) },
              { header: "Eng.", numeric: true, cell: (row) => ratioPercent(row.engagementRate) },
            ]}
          />
          <ChannelBreakdown channels={data.topChannels} totalSessions={data.summary.sessions} />
        </SplitLayout>
      )}
    </>
  );
}

function Ga4Trend({ trend, metric }: { trend: GA4Stats["trend"]; metric: TrendKey }) {
  const label = TREND_OPTIONS.find((o) => o.key === metric)!.label;
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
        ariaSummary={`Daily ${label.toLowerCase()} over the last ${PERIOD_DAYS} days, ${points.length} days of data.`}
      />
      <SrTable
        caption={`Daily ${label.toLowerCase()}`}
        head={["Date", label]}
        rows={points.map((p) => [new Date(p.t).toLocaleDateString("en-US"), formatNumber(p.v)])}
      />
    </div>
  );
}

/**
 * Where sessions come from — a ranked bar list (one series, one hue, each
 * bar directly labeled with its count and share, so nothing is carried by
 * color or hover alone). Share is of all sessions in the period.
 */
function ChannelBreakdown({ channels, totalSessions }: { channels: GA4Stats["topChannels"]; totalSessions: number }) {
  const sorted = [...channels].sort((a, b) => b.sessions - a.sessions);
  const max = sorted[0]?.sessions ?? 0;

  return (
    <Section title="Traffic by channel" description="Sessions by acquisition channel">
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">No channel data recorded in this period.</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {sorted.map((ch) => {
            const width = max > 0 ? Math.max(2, (ch.sessions / max) * 100) : 0;
            const share = totalSessions > 0 ? Math.min(100, (ch.sessions / totalSessions) * 100) : null;
            return (
              <li key={ch.channel} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] text-foreground">{ch.channel}</span>
                  <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-foreground">
                    {formatNumber(ch.sessions)}
                    <span className="ml-2 text-muted-foreground">{share === null ? "—" : `${share.toFixed(0)}%`}</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                </div>
                <span className="text-[12px] text-muted-foreground">{formatNumber(ch.users)} users</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
