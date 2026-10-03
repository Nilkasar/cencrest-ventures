"use client";

import { useState } from "react";
import { Cable, MousePointerClick } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";
import { ConnectorNotConnectedError, OAuthNotConfiguredError, TokenExpiredError, getGA4Stats, getGSCStats } from "@/data/connectors/client";
import { AnimatedNumber, Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable } from "./primitives";
import { TrendChart } from "./trend-chart";

/**
 * "Where do I stand in search?" — the brand's own first-party numbers, last
 * 28 days, straight from its connected Google accounts:
 *
 *   Search  -> `GET /integrations/gsc/stats` (Search Console)
 *   Traffic -> `GET /integrations/ga4/stats` (Analytics 4)
 *
 * One measure per chart, switched with a segmented control — clicks and
 * impressions differ by orders of magnitude and never share an axis. A
 * source that isn't connected says so and links to Connectors; a stale
 * token says reconnect. Neither ever renders a placeholder curve.
 */

const NUM = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

const toTime = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

export function TrafficPanel({ className }: { className?: string }) {
  const gsc = useAsyncData(() => getGSCStats(28), []);
  const ga4 = useAsyncData(() => getGA4Stats(28), []);
  return (
    <Panel eyebrow="Search & traffic · last 28 days" title="First-party signal" icon={<MousePointerClick size={14} />} href="/connectors" hrefLabel="Connectors" className={className}>
      <Tabs defaultValue="search">
        <TabsList aria-label="Data source">
          <TabsTrigger value="search" className="h-8">Search Console</TabsTrigger>
          <TabsTrigger value="traffic" className="h-8">Analytics 4</TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          {gsc.status === "loading" && <PanelSkeleton height={290} />}
          {gsc.status === "error" && <SourceError error={gsc.error} source="Search Console" onRetry={gsc.reload} />}
          {gsc.status === "success" && (
            <SourceView
              summary={[
                { label: "Clicks", value: gsc.data.summary.totalClicks, format: (v) => NUM.format(Math.round(v)) },
                { label: "Impressions", value: gsc.data.summary.totalImpressions, format: (v) => COMPACT.format(v) },
                { label: "Avg CTR", value: gsc.data.summary.avgCtr, format: (v) => PCT.format(v) },
                { label: "Avg position", value: gsc.data.summary.avgPosition, format: (v) => v.toFixed(1) },
              ]}
              metrics={[
                { key: "clicks", label: "Clicks", points: gsc.data.trend.map((d) => ({ t: toTime(d.date), v: d.clicks })) },
                { key: "impressions", label: "Impressions", points: gsc.data.trend.map((d) => ({ t: toTime(d.date), v: d.impressions })) },
              ]}
            />
          )}
        </TabsContent>
        <TabsContent value="traffic">
          {ga4.status === "loading" && <PanelSkeleton height={290} />}
          {ga4.status === "error" && <SourceError error={ga4.error} source="Analytics 4" onRetry={ga4.reload} />}
          {ga4.status === "success" && (
            <SourceView
              summary={[
                { label: "Sessions", value: ga4.data.summary.sessions, format: (v) => NUM.format(Math.round(v)) },
                { label: "Users", value: ga4.data.summary.users, format: (v) => NUM.format(Math.round(v)) },
                { label: "Engagement", value: ga4.data.summary.engagementRate, format: (v) => PCT.format(v) },
                { label: "Page views", value: ga4.data.summary.pageViews, format: (v) => COMPACT.format(v) },
              ]}
              metrics={[
                { key: "sessions", label: "Sessions", points: ga4.data.trend.map((d) => ({ t: toTime(d.date), v: d.sessions })) },
                { key: "users", label: "Users", points: ga4.data.trend.map((d) => ({ t: toTime(d.date), v: d.users })) },
                { key: "pageViews", label: "Page views", points: ga4.data.trend.map((d) => ({ t: toTime(d.date), v: d.pageViews })) },
              ]}
            />
          )}
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

function SourceError({ error, source, onRetry }: { error: Error; source: string; onRetry: () => void }) {
  if (error instanceof ConnectorNotConnectedError) {
    return (
      <PanelEmpty
        icon={<Cable size={16} />}
        height={290}
        title={`${source} isn’t connected`}
        body={`Connect ${source} to see your real ${source === "Search Console" ? "clicks and impressions" : "sessions and users"} trend right here.`}
        action={{ href: "/connectors", label: `Connect ${source}` }}
      />
    );
  }
  if (error instanceof TokenExpiredError) {
    return (
      <PanelEmpty
        icon={<Cable size={16} />}
        height={290}
        title="Connection expired"
        body={`Google’s access token for ${source} has expired. Reconnect to resume the feed.`}
        action={{ href: "/connectors", label: "Reconnect" }}
      />
    );
  }
  if (error instanceof OAuthNotConfiguredError) {
    return <PanelEmpty icon={<Cable size={16} />} height={290} title="Google sign-in isn’t configured" body={error.message} />;
  }
  return <PanelError onRetry={onRetry} height={290} />;
}

interface Metric {
  key: string;
  label: string;
  points: { t: number; v: number }[];
}

function SourceView({ summary, metrics }: { summary: { label: string; value: number; format: (v: number) => string }[]; metrics: Metric[] }) {
  const [metricKey, setMetricKey] = useState(metrics[0]!.key);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0]!;
  const points = [...metric.points].sort((a, b) => a.t - b.t);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 @2xl:grid-cols-4 gap-3">
        {summary.map((s) => (
          <div key={s.label} className="rounded-lg bg-surface px-3 py-2 min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground">{s.label}</dt>
            <dd className="mt-0.5 text-[18px] font-semibold text-foreground">
              <AnimatedNumber value={s.value} format={s.format} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-1" role="group" aria-label="Chart metric">
        {metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={m.key === metric.key}
            onClick={() => setMetricKey(m.key)}
            className={cn(
              "h-8 rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              m.key === metric.key ? "bg-accent-muted text-accent" : "text-muted-foreground hover:text-foreground hover:bg-surface",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground py-10 text-center">No daily data returned for this period yet.</p>
      ) : (
        <TrendChart
          key={metric.key}
          points={points}
          height={200}
          formatValue={(v) => COMPACT.format(v)}
          ariaSummary={`Daily ${metric.label.toLowerCase()} over the last 28 days, ${points.length} days of data.`}
        />
      )}
      <SrTable caption={`Daily ${metric.label.toLowerCase()}`} head={["Date", metric.label]} rows={points.map((p) => [new Date(p.t).toLocaleDateString("en-US"), NUM.format(p.v)])} />
    </div>
  );
}
