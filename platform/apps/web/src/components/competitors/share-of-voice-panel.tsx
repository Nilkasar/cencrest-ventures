"use client";

import { PieChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton, cn } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getShareOfVoice } from "@/data/competitive-intelligence/client";

/**
 * Share of AI Voice = your mentions / (your mentions + every tracked
 * competitor's mentions) x 100 (`docs/epics/08-competitive-intelligence.md`).
 * Rendered as a stacked horizontal bar (one segment per entity, widths
 * proportional to share) plus the exact numbers below it — the visual
 * answers "who's winning at a glance," the numbers back it with evidence,
 * per `packages/ui/DESIGN.md`'s "precision over decoration" direction.
 */
export function ShareOfVoicePanel() {
  const state = useAsyncData(() => getShareOfVoice(), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share of AI Voice</CardTitle>
        <CardDescription>Of every mention across your tracked competitors, how much of it is you.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "loading" && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        )}

        {state.status === "error" && <ErrorPanel compact message={state.error.message} onRetry={state.reload} />}

        {state.status === "success" && state.data === null && (
          <EmptyState
            compact
            icon={<PieChart size={18} />}
            title="No active query set"
            description="Share of AI Voice compares mentions across your brand and competitors on your active query set — activate one in Query Universe first."
          />
        )}

        {state.status === "success" && state.data !== null && <ShareOfVoiceBody data={state.data} />}
      </CardContent>
    </Card>
  );
}

const SEGMENT_COLORS = ["bg-accent", "bg-warning", "bg-danger", "bg-info", "bg-success", "bg-subtle-foreground"] as const;

function segmentColor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length] ?? "bg-subtle-foreground";
}

function ShareOfVoiceBody({ data }: { data: NonNullable<Awaited<ReturnType<typeof getShareOfVoice>>> }) {
  if (data.totalMentions === 0) {
    return (
      <EmptyState
        compact
        icon={<PieChart size={18} />}
        title="No mentions yet"
        description="Run your AI Visibility baseline and at least one competitor check on this query set — Share of Voice needs real mentions to compare."
      />
    );
  }

  const ranked = [...data.competitors].sort((a, b) => b.sharePct - a.sharePct);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full bg-accent" style={{ width: `${data.yourSharePct}%` }} title={`You — ${data.yourSharePct}%`} />
        {ranked.map((c, i) => (
          <div
            key={c.competitorId}
            className={cn("h-full", segmentColor(i + 1))}
            style={{ width: `${c.sharePct}%` }}
            title={`${c.competitorName} — ${c.sharePct}%`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Row label="You" sharePct={data.yourSharePct} mentions={data.yourMentions} colorClassName="bg-accent" highlight />
        {ranked.map((c, i) => (
          <Row
            key={c.competitorId}
            label={c.competitorName}
            sharePct={c.sharePct}
            mentions={c.mentions}
            colorClassName={segmentColor(i + 1)}
            note={c.tracked ? undefined : "not yet run on this query set"}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  sharePct,
  mentions,
  colorClassName,
  highlight = false,
  note,
}: {
  label: string;
  sharePct: number;
  mentions: number;
  colorClassName: string;
  highlight?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("size-2.5 rounded-full shrink-0", colorClassName)} aria-hidden="true" />
        <span className={cn("text-[13px] truncate", highlight ? "font-medium text-foreground" : "text-foreground")}>{label}</span>
        {note && <span className="text-[11.5px] text-subtle-foreground shrink-0">({note})</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[12px] text-muted-foreground">{mentions} mentions</span>
        <span className="font-mono text-[13px] font-semibold text-foreground w-14 text-right">{sharePct}%</span>
      </div>
    </div>
  );
}
