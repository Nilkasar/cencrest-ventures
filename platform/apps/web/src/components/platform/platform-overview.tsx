"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Building, ChevronRight, Hourglass, Radar, RefreshCw, TrendingUp, UsersRound } from "lucide-react";
import { Badge, Button, Card, RefreshOverlay, Skeleton, cn } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { fetchCapabilities, fetchPlatformOverview } from "@/data/platform/client";
import type { PlatformOverview as Overview, StatusCounts } from "@/data/platform/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useSession } from "@/lib/session-context";
import { CapabilityMatrix } from "./capability-matrix";
import { PlatformErrorState, TimeAgo, humanize } from "./platform-ui";

/**
 * Platform → Overview: "Is the platform healthy, and what can it do?"
 * Two independent requests fired together on mount (no waterfall): the KPI
 * aggregate and the capability matrix. The matrix works even when the
 * platform database isn't configured, so one failing never blanks the other.
 */
export function PlatformOverview() {
  const overview = useAsyncData(fetchPlatformOverview, []);
  const capabilities = useAsyncData(fetchCapabilities, []);
  const { platformRole, user } = useSession();

  const data = overview.status === "success" ? overview.data : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Platform overview"
        description="Every organization, user and background job across BeBest — and which capabilities are working right now. Every request made here is audited."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {platformRole !== "none" && (
              <Badge variant="accent" dot title={user ? `Signed in as ${user.email}` : undefined}>
                Platform {platformRole}
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                overview.reload();
                capabilities.reload();
              }}
              loading={overview.isRefreshing}
              disabled={overview.status === "loading"}
            >
              {!overview.isRefreshing && <RefreshCw size={13} aria-hidden />} Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-10">
        <section aria-labelledby="platform-kpis" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="platform-kpis" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
              At a glance
            </h2>
            {data && (
              <p className="text-[12px] text-subtle-foreground">
                As of <TimeAgo iso={data.generatedAt} className="text-[12px] text-subtle-foreground" />
              </p>
            )}
          </div>

          {overview.status === "loading" && <KpiSkeleton />}
          {overview.status === "error" && <PlatformErrorState error={overview.error} onRetry={overview.reload} resource="platform KPIs" compact />}
          {data && (
            <RefreshOverlay active={overview.isRefreshing}>
              <KpiGrid data={data} />
            </RefreshOverlay>
          )}
        </section>

        <CapabilityMatrix state={capabilities} />
      </div>
    </>
  );
}

function pct(rate: number | null): string {
  if (rate === null) return "—";
  const v = rate * 100;
  return `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
}

function KpiGrid({ data }: { data: Overview }) {
  const o = data.organizations;
  const u = data.users;
  const ai = data.aiRuns;
  const stuck = data.stuckJobs;
  const failRateHigh = ai.failureRate7d !== null && ai.failureRate7d >= 0.1;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <KpiTile href="/platform/organizations" icon={<Building size={14} />} eyebrow="Organizations">
        <BigNumber value={o.total} />
        <Delta value={o.new7d} label="new this week" />
        <Breakdown counts={o.byKind} order={["customer", "agency", "internal"]} />
      </KpiTile>

      <KpiTile href="/platform/users" icon={<UsersRound size={14} />} eyebrow="Active users · 7 days">
        <div className="flex items-baseline gap-2">
          <BigNumber value={u.active7d} />
          <span className="font-mono text-[13px] text-subtle-foreground">/ {u.total.toLocaleString()}</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          <span className="font-mono text-foreground">{u.active30d.toLocaleString()}</span> active in 30 days ·{" "}
          <span className="font-mono text-foreground">{u.new7d.toLocaleString()}</span> new this week
        </p>
        <p className="text-[12px] text-subtle-foreground">{u.platformStaff} platform staff</p>
      </KpiTile>

      <KpiTile href="/platform/operations?type=ai_run" icon={<Radar size={14} />} eyebrow="AI runs today">
        <div className="flex items-baseline gap-2">
          <BigNumber value={ai.today} />
          {ai.todayFailed > 0 && (
            <Badge variant="danger" size="sm">
              {ai.todayFailed} failed
            </Badge>
          )}
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          <span className={cn("font-mono", failRateHigh ? "text-danger" : "text-foreground")}>{pct(ai.failureRate7d)}</span> failure rate ·{" "}
          <span className="font-mono text-foreground">{ai.last7d.toLocaleString()}</span> runs in 7 days
        </p>
        <Breakdown counts={ai.byStatus7d} order={["completed", "running", "queued", "failed"]} />
      </KpiTile>

      <KpiTile
        href="/platform/operations?stuck=true"
        icon={<Hourglass size={14} />}
        eyebrow="Stuck jobs"
        tone={stuck.total > 0 ? "warning" : undefined}
        ariaLabel={`Stuck jobs: ${stuck.total}. Open Operations filtered to stuck jobs.`}
      >
        <div className="flex items-baseline gap-2">
          <BigNumber value={stuck.total} className={stuck.total > 0 ? "text-warning" : undefined} />
          {stuck.total > 0 && <AlertTriangle size={15} className="text-warning" aria-hidden />}
        </div>
        <p className="text-[12.5px] text-muted-foreground">Active for more than {stuck.thresholdMinutes} minutes</p>
        <Breakdown counts={stuck.byType} order={["crawl", "ai_run", "agent_run", "snapshot"]} hideZero={false} />
      </KpiTile>

      <KpiTile href="/platform/operations" icon={<Activity size={14} />} eyebrow="Background work · 7 days">
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Crawls" value={data.crawlJobs.last7d} rate={data.crawlJobs.failureRate7d} />
          <MiniStat label="Agent runs" value={data.agentRuns.last7d} rate={data.agentRuns.failureRate7d} />
        </div>
      </KpiTile>

      <KpiTile href="/platform/growth" icon={<TrendingUp size={14} />} eyebrow="Growth · 7 days">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            {data.leads ? (
              <span className="font-mono text-[24px] font-semibold leading-none tabular-nums text-foreground">{data.leads.new7d}</span>
            ) : (
              <span className="text-[12.5px] text-subtle-foreground" title="CRM_INTERNAL_ORG_ID isn't set on the API">
                CRM not configured
              </span>
            )}
            <span className="text-[12px] text-muted-foreground">new leads</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[24px] font-semibold leading-none tabular-nums text-foreground">{data.snapshots.last7d}</span>
            <span className="text-[12px] text-muted-foreground">snapshot requests</span>
          </div>
        </div>
        <Breakdown counts={data.snapshots.byStatus7d} order={["complete", "processing", "pending", "failed"]} />
      </KpiTile>
    </div>
  );
}

function KpiTile({
  href,
  icon,
  eyebrow,
  tone,
  ariaLabel,
  children,
}: {
  href: string;
  icon: ReactNode;
  eyebrow: string;
  tone?: "warning";
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          "flex h-full min-h-[148px] flex-col gap-2.5 p-4 transition-[border-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
          "group-hover:-translate-y-0.5 group-hover:border-accent group-hover:shadow-md motion-reduce:group-hover:translate-y-0",
          tone === "warning" && "border-warning/50",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                tone === "warning" ? "bg-warning-muted text-warning" : "bg-surface text-muted-foreground group-hover:bg-accent-muted group-hover:text-accent",
              )}
              aria-hidden
            >
              {icon}
            </span>
            <p className="truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground">{eyebrow}</p>
          </div>
          <ChevronRight size={14} className="shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2">{children}</div>
      </Card>
    </Link>
  );
}

function BigNumber({ value, className }: { value: number; className?: string }) {
  return <span className={cn("font-mono text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground", className)}>{value.toLocaleString()}</span>;
}

function Delta({ value, label }: { value: number; label: string }) {
  return (
    <p className="text-[12.5px] text-muted-foreground">
      <span className={cn("font-mono", value > 0 ? "text-success" : "text-foreground")}>{value > 0 ? `+${value}` : value}</span> {label}
    </p>
  );
}

function MiniStat({ label, value, rate }: { label: string; value: number; rate: number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[24px] font-semibold leading-none tabular-nums text-foreground">{value.toLocaleString()}</span>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[11.5px]", rate !== null && rate >= 0.1 ? "text-danger" : "text-subtle-foreground")}>
        {pct(rate)} failed
      </span>
    </div>
  );
}

/** Compact "label n · label n" composition line from a counts map. */
function Breakdown({ counts, order, hideZero = true }: { counts: StatusCounts; order: string[]; hideZero?: boolean }) {
  const keys = [...order, ...Object.keys(counts).filter((k) => !order.includes(k))];
  const entries = keys.map((k) => [k, counts[k] ?? 0] as const).filter(([, n]) => !hideZero || n > 0);
  if (entries.length === 0) return <p className="text-[12px] text-subtle-foreground">None in this window</p>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {entries.map(([k, n]) => (
        <li key={k} className="text-[12px] text-subtle-foreground">
          {humanize(k)} <span className={cn("font-mono", n > 0 ? "text-foreground" : "text-subtle-foreground")}>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading platform KPIs">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex min-h-[148px] flex-col gap-3 p-4">
          <Skeleton className="h-3 w-28" />
          <div className="flex-1" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-40" />
        </Card>
      ))}
    </div>
  );
}
