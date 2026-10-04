"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Loader, ShieldCheck, Sparkles } from "lucide-react";
import { Button, EmptyState, Pagination, RefreshOverlay, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar } from "@/components/patterns/toolbar";
import { NoResults } from "@/components/patterns/states";
import { useAsyncData } from "@/lib/use-async-data";
import { listRecommendations, updateRecommendationStatus } from "@/data/recommendations/client";
import type { Recommendation, RecommendationActionType, RecommendationStatus } from "@/data/recommendations/types";
import { ACTION_TYPE_LABEL, RECOMMENDATION_STATUS_LABEL } from "@/data/recommendations/labels";
import { approvePendingAction, listPendingActionsByRecommendationId } from "@/data/agents/client";
import type { AgentPendingAction } from "@/data/agents/types";
import { formatNumber, formatPercent } from "@/lib/format";
import { RecommendationCard } from "./recommendation-card";

const STATUS_OPTIONS: { value: RecommendationStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(["new", "in_progress", "completed", "dismissed"] as const).map((s) => ({ value: s, label: RECOMMENDATION_STATUS_LABEL[s] })),
];
const ACTION_TYPE_OPTIONS: { value: RecommendationActionType | "all"; label: string }[] = [
  { value: "all", label: "All action types" },
  ...(["create_page", "update_page", "fix_technical", "build_citations"] as const).map((t) => ({ value: t, label: ACTION_TYPE_LABEL[t] })),
];
const SHOW_OPTIONS = [
  { value: "10", label: "10 per page" },
  { value: "25", label: "25 per page" },
  { value: "50", label: "50 per page" },
] as const;
type ShowValue = (typeof SHOW_OPTIONS)[number]["value"];

/** Whole-brand status totals for the stat row — one `limit=1` request per
 *  status reading the server's `pagination.total`, so the tiles count every
 *  recommendation, never just the page on screen. */
async function loadStatusCounts(): Promise<Record<RecommendationStatus | "all", number>> {
  const statuses: RecommendationStatus[] = ["new", "in_progress", "completed", "dismissed"];
  const [all, ...rest] = await Promise.all([
    listRecommendations({ limit: 1 }),
    ...statuses.map((status) => listRecommendations({ status, limit: 1 })),
  ]);
  return {
    all: all!.pagination.total,
    new: rest[0]!.pagination.total,
    in_progress: rest[1]!.pagination.total,
    completed: rest[2]!.pagination.total,
    dismissed: rest[3]!.pagination.total,
  };
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised shadow-sm" aria-busy="true">
      <span className="sr-only">Loading recommendations…</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-4" aria-hidden="true">
          <Skeleton className="hidden size-11 shrink-0 rounded-lg sm:block" />
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Epic 10 (Recommendation Engine)'s screen — "What should I do next?"
 * Calls the real `GET /brands/me/recommendations` / `PATCH
 * /recommendations/:id`. Sorted by `priorityRank` desc server-side, never
 * re-sorted here; defaults to a page of 10 (the journey doc's short,
 * prioritized list), with a per-page control and real paging.
 */
export function RecommendationsView() {
  const [statusFilter, setStatusFilter] = useState<RecommendationStatus | "all">("all");
  const [actionTypeFilter, setActionTypeFilter] = useState<RecommendationActionType | "all">("all");
  const [show, setShow] = useState<ShowValue>("10");
  const [page, setPage] = useState(1);
  const pageSize = Number(show);

  const { reload, ...state } = useAsyncData(
    () =>
      listRecommendations({
        status: statusFilter === "all" ? undefined : statusFilter,
        actionType: actionTypeFilter === "all" ? undefined : actionTypeFilter,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    [statusFilter, actionTypeFilter, pageSize, page],
  );
  const { reload: reloadCounts, ...countsState } = useAsyncData(loadStatusCounts, []);

  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Epic 12 — Level 3's one-click approval, surfaced inline on the row it
  // targets rather than in a separate inbox. A best-effort join, not this
  // screen's primary data (see `listPendingActionsByRecommendationId`).
  const { reload: reloadPendingActions, ...pendingActionsState } = useAsyncData(() => listPendingActionsByRecommendationId(), []);
  const pendingByRecommendationId: Map<string, { pendingAction: AgentPendingAction; agentRunId: string }> =
    pendingActionsState.status === "success" ? pendingActionsState.data : new Map();

  async function handleApprovePendingAction(agentRunId: string) {
    try {
      await approvePendingAction(agentRunId);
      toast({ title: "Action approved", description: "A 30-day rollback window has started. This has not published anything." });
      reloadPendingActions();
    } catch (err) {
      toast({
        title: "Couldn't approve that action",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    }
  }

  async function handleStatusChange(recommendation: Recommendation, status: RecommendationStatus) {
    setUpdatingId(recommendation.id);
    try {
      await updateRecommendationStatus(recommendation.id, status);
      reload();
      reloadCounts();
    } catch (err) {
      toast({
        title: "Couldn't update that recommendation",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  const hasFilters = statusFilter !== "all" || actionTypeFilter !== "all";
  function clearFilters() {
    setStatusFilter("all");
    setActionTypeFilter("all");
    setPage(1);
  }

  const data = state.status === "success" ? state.data : null;
  const counts = countsState.status === "success" ? countsState.data : null;
  const firstRun = data !== null && data.pagination.total === 0 && !hasFilters;
  const awaitingApproval = pendingActionsState.status === "success" ? pendingActionsState.data.size : null;

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid>
          <StatTile
            label="To do"
            icon={<CircleDashed size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.new) : "—"}
            hint="Not started yet"
          />
          <StatTile
            label="In progress"
            icon={<Loader size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.in_progress) : "—"}
            hint="Being worked on"
          />
          <StatTile
            label="Completed"
            icon={<CheckCircle2 size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.completed) : "—"}
            hint={
              counts && counts.all > 0
                ? `${formatPercent((counts.completed / counts.all) * 100)} of ${formatNumber(counts.all)} recommendations`
                : "Shipped and done"
            }
          />
          <StatTile
            label="Awaiting approval"
            icon={<ShieldCheck size={13} />}
            loading={awaitingApproval === null && pendingActionsState.status === "loading"}
            value={awaitingApproval !== null ? formatNumber(awaitingApproval) : "—"}
            muted={awaitingApproval === null}
            hint="Agent actions proposed for these"
          />
        </StatGrid>
      )}

      {!firstRun && (
        <Toolbar end={data && <ResultCount count={data.pagination.total} noun="recommendation" />}>
          <FilterSelect
            value={actionTypeFilter}
            onValueChange={(value) => {
              setActionTypeFilter(value);
              setPage(1);
            }}
            options={ACTION_TYPE_OPTIONS}
            label="Filter by action type"
            className="sm:w-44"
          />
          <FilterSelect
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            label="Filter by status"
          />
          <FilterSelect
            value={show}
            onValueChange={(value) => {
              setShow(value);
              setPage(1);
            }}
            options={[...SHOW_OPTIONS]}
            label="Recommendations per page"
            className="sm:w-36"
          />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" && <ListSkeleton />}

        {state.status === "error" && <ErrorPanel title="Recommendations didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="No recommendations yet"
            description="Each recommendation is generated from an opportunity's evidence. Open an opportunity and generate its next action — it lands here, ranked by priority."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/opportunities">Go to Opportunities</Link>
              </Button>
            }
          />
        )}

        {data && data.recommendations.length === 0 && hasFilters && (
          <NoResults noun="recommendations" onClear={clearFilters} hint="Try a different action type or status." />
        )}

        {data && data.recommendations.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Section flush title="Prioritized" description="Highest priority first — cheap, high-impact moves surface at the top.">
              <ul className="divide-y divide-border">
                {data.recommendations.map((recommendation) => {
                  const pending = pendingByRecommendationId.get(recommendation.id);
                  return (
                    <li key={recommendation.id}>
                      <RecommendationCard
                        recommendation={recommendation}
                        updating={updatingId === recommendation.id}
                        onStatusChange={handleStatusChange}
                        pendingAction={pending?.pendingAction}
                        onApprovePendingAction={pending ? () => handleApprovePendingAction(pending.agentRunId) : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            </Section>
            <Pagination page={page} pageSize={pageSize} total={data.pagination.total} onPageChange={setPage} itemLabel="recommendations" />
          </RefreshOverlay>
        )}
      </Reveal>
    </PageStack>
  );
}
