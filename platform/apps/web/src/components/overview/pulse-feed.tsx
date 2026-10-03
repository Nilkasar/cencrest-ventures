"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { motion } from "framer-motion";
import { Activity, Bot, FileText } from "lucide-react";
import { cn, easings } from "@bebest/ui";
import { listNotifications } from "@/data/notifications/client";
import { NOTIFICATION_TYPE_ICON, NOTIFICATION_TYPE_LABEL } from "@/data/notifications/labels";
import { listAgentRuns } from "@/data/agents/client";
import type { AgentRun } from "@/data/agents/types";
import { AGENT_NAME_LABEL, AGENT_RUN_STATUS_LABEL } from "@/data/agents/labels";
import { listReports } from "@/data/reporting/client";
import { formatRelativeTime } from "@/lib/format";
import { Panel, PanelEmpty, PanelError, PanelSkeleton, usePolledData } from "./primitives";

/**
 * The workspace's heartbeat — one merged, newest-first timeline of what
 * actually happened, drawn from three real sources:
 *
 *   - in-app notifications (`GET /notifications`): runs completing, score
 *     changes, competitor movement, new recommendations…
 *   - agent runs (`GET /brands/me/agents`): any run still `queued`/`running`
 *     is pinned on top with its real step progress, and the feed polls
 *     every 10s until it finishes;
 *   - generated reports (`GET /brands/me/reports`).
 *
 * Sources load independently (`allSettled`): one failing source drops out
 * of the feed with a note rather than blanking it.
 */

interface FeedItem {
  id: string;
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
  icon: ComponentType<{ size?: number; className?: string }>;
  unread?: boolean;
  tone?: "danger";
}

export function PulseFeed({ className }: { className?: string }) {
  const state = usePolledData(
    async () => {
      const [notifs, agents, reports] = await Promise.allSettled([listNotifications({ limit: 30 }), listAgentRuns(), listReports({ limit: 5 })]);
      if (notifs.status === "rejected" && agents.status === "rejected" && reports.status === "rejected") throw notifs.reason;
      return {
        notifications: notifs.status === "fulfilled" ? notifs.value.items : [],
        agents: agents.status === "fulfilled" ? agents.value : [],
        reports: reports.status === "fulfilled" ? reports.value.items : [],
        failed: [notifs, agents, reports].filter((r) => r.status === "rejected").length,
      };
    },
    [],
    (d) => (d.agents.some((a) => a.status === "running" || a.status === "queued") ? 10000 : null),
  );

  const running = state.status === "success" ? state.data.agents.filter((a) => a.status === "running" || a.status === "queued") : [];

  return (
    <Panel eyebrow="Pulse" title="What just happened" icon={<Activity size={14} />} live={running.length > 0} className={className}>
      {state.status === "loading" && <PanelSkeleton height={300} />}
      {state.status === "error" && <PanelError onRetry={state.reload} height={300} />}
      {state.status === "success" && <Feed {...state.data} running={running} />}
    </Panel>
  );
}

function Feed({
  notifications,
  agents,
  reports,
  failed,
  running,
}: {
  notifications: Awaited<ReturnType<typeof listNotifications>>["items"];
  agents: AgentRun[];
  reports: Awaited<ReturnType<typeof listReports>>["items"];
  failed: number;
  running: AgentRun[];
}) {
  const items: FeedItem[] = [
    ...notifications.map((n) => ({
      id: `n-${n.id}`,
      at: n.createdAt,
      title: n.title,
      detail: n.body ?? NOTIFICATION_TYPE_LABEL[n.type],
      href: n.actionUrl?.startsWith("/") ? n.actionUrl : null,
      icon: NOTIFICATION_TYPE_ICON[n.type],
      unread: n.userId !== null && n.readAt === null,
    })),
    ...agents
      .filter((a) => a.status === "completed" || a.status === "failed")
      .map((a) => ({
        id: `a-${a.id}`,
        at: a.completedAt ?? a.updatedAt,
        title: `${AGENT_NAME_LABEL[a.agentName]} ${AGENT_RUN_STATUS_LABEL[a.status].toLowerCase()}`,
        detail: a.status === "failed" ? (a.error ?? "Run failed") : `${a.stepsCompleted} steps · ${a.tokensUsed.toLocaleString("en-US")} tokens`,
        href: `/agents/${a.id}`,
        icon: Bot,
        tone: a.status === "failed" ? ("danger" as const) : undefined,
      })),
    ...reports.map((r) => ({
      id: `r-${r.id}`,
      at: r.generatedAt,
      title: `Report ready: ${r.name}`,
      detail: `${r.type.replace(/_/g, " ")} report`,
      href: `/reports/${r.id}`,
      icon: FileText,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);

  if (items.length === 0 && running.length === 0) {
    return (
      <PanelEmpty
        icon={<Activity size={16} />}
        height={280}
        title="Quiet so far"
        body="Runs finishing, score changes, agent work and reports will stream in here as they happen. Kick off an agent to see it live."
        action={{ href: "/agents", label: "Open Agents" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {running.map((a) => {
        const pct = a.totalSteps > 0 ? Math.round((a.stepsCompleted / a.totalSteps) * 100) : 0;
        return (
          <Link
            key={a.id}
            href={`/agents/${a.id}`}
            className="block rounded-lg border border-accent/40 bg-accent-muted/60 px-3 py-2.5 hover:border-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                <span className="ov-live size-1.5 rounded-full bg-accent text-accent" aria-hidden="true" />
                {AGENT_NAME_LABEL[a.agentName]} {a.status === "queued" ? "queued" : "working"}
              </p>
              <span className="font-mono text-[11px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {a.totalSteps > 0 ? `${a.stepsCompleted}/${a.totalSteps} steps` : "starting"}
              </span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-surface overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${AGENT_NAME_LABEL[a.agentName]} progress`}>
              <motion.div className="h-full bg-accent origin-left" initial={false} animate={{ scaleX: pct / 100 }} transition={{ duration: 0.6, ease: easings.emphasized }} />
            </div>
          </Link>
        );
      })}

      <ol className="relative flex flex-col">
        <span className="absolute left-[13px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
        {items.map((item, i) => {
          const Icon = item.icon;
          const body = (
            <>
              <span
                className={cn(
                  "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border bg-surface-raised",
                  item.tone === "danger" ? "border-danger/40 text-danger" : "border-border text-muted-foreground group-hover:text-accent group-hover:border-accent/50",
                )}
                aria-hidden="true"
              >
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-foreground truncate">{item.title}</span>
                  {item.unread && <span className="size-1.5 rounded-full bg-accent shrink-0" aria-label="unread" />}
                </span>
                {item.detail && <span className="block text-[11.5px] text-muted-foreground truncate">{item.detail}</span>}
              </span>
              <time dateTime={item.at} className="font-mono text-[10.5px] text-subtle-foreground shrink-0 pt-0.5">
                {formatRelativeTime(item.at)}
              </time>
            </>
          );
          return (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease: easings.emphasized }}
            >
              {item.href ? (
                <Link href={item.href} className="group flex items-start gap-3 rounded-md py-2 pr-1 min-h-[44px] hover:bg-surface/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 py-2 pr-1 min-h-[44px]">{body}</div>
              )}
            </motion.li>
          );
        })}
      </ol>

      {failed > 0 && <p className="text-[11px] text-subtle-foreground">Some activity sources couldn’t load and are missing from this feed.</p>}
    </div>
  );
}
