"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Flag, Inbox, RefreshCw, Target } from "lucide-react";
import { Button, Card, EmptyState, Pagination, RefreshOverlay, Skeleton, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { NoResults } from "@/components/patterns/states";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar } from "@/components/patterns/toolbar";
import { useAsyncData } from "@/lib/use-async-data";
import {
  NoActiveQuerySetError,
  NoBrandProfileError,
  listOpportunities,
  recomputeOpportunities,
  updateOpportunity,
} from "@/data/opportunities/client";
import type { Opportunity, OpportunityPriority, OpportunityStatus, OpportunityType } from "@/data/opportunities/types";
import { OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_TYPE_LABEL, PRIORITY_LABEL, scoreBand, type ScoreBand } from "@/data/opportunities/labels";
import { generateRecommendation, listRecommendations, updateRecommendationStatus } from "@/data/recommendations/client";
import type { Recommendation, RecommendationStatus } from "@/data/recommendations/types";
import { approvePendingAction, listPendingActionsByRecommendationId } from "@/data/agents/client";
import type { AgentPendingAction } from "@/data/agents/types";
import { formatNumber } from "@/lib/format";
import { OpportunityCard } from "./opportunity-card";

type PriorityFilter = "all" | "1" | "2" | "3";

const STATUS_OPTIONS: { value: OpportunityStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(["new", "in_progress", "completed", "dismissed"] as const).map((s) => ({ value: s, label: OPPORTUNITY_STATUS_LABEL[s] })),
];
const TYPE_OPTIONS: { value: OpportunityType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  ...(["unified", "seo", "geo", "content", "technical"] as const).map((t) => ({ value: t, label: OPPORTUNITY_TYPE_LABEL[t] })),
];
const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: "all", label: "All priorities" },
  ...([1, 2, 3] as const).map((p) => ({ value: String(p) as PriorityFilter, label: PRIORITY_LABEL[p] })),
];
const BAND_LABEL: Record<ScoreBand, string> = { high: "High", medium: "Medium", low: "Low" };
const IMPACT_OPTIONS: { value: ScoreBand | "all"; label: string }[] = [
  { value: "all", label: "Any impact" },
  ...(["high", "medium", "low"] as const).map((b) => ({ value: b, label: `${BAND_LABEL[b]} impact` })),
];
const EFFORT_OPTIONS: { value: ScoreBand | "all"; label: string }[] = [
  { value: "all", label: "Any effort" },
  ...(["low", "medium", "high"] as const).map((b) => ({ value: b, label: `${BAND_LABEL[b]} effort` })),
];

const PAGE_SIZE = 25;

/**
 * Opportunities — "What should I do next?" (`docs/09-ux/CUSTOMER_JOURNEY.md`
 * calls it the single most important screen in the product).
 *
 *   - Headline counts are real API totals (`pagination.total` per status /
 *     priority), never a count of the rows on this page.
 *   - `status`/`type`/`priority` are server-side query params. `impact`/
 *     `effort` have no API params, so they narrow the already-fetched page
 *     client-side via `scoreBand` (a known limitation — current page only).
 *   - Recommendations (Epic 10) and pending agent actions (Epic 12) are
 *     joined by id client-side: one list fetch each, never N+1.
 */
export function OpportunitiesView() {
  const [statusFilter, setStatusFilter] = useState<OpportunityStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<OpportunityType | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [impactFilter, setImpactFilter] = useState<ScoreBand | "all">("all");
  const [effortFilter, setEffortFilter] = useState<ScoreBand | "all">("all");
  const [page, setPage] = useState(1);

  const { reload, ...state } = useAsyncData(
    () =>
      listOpportunities({
        status: statusFilter === "all" ? undefined : statusFilter,
        type: typeFilter === "all" ? undefined : typeFilter,
        priority: priorityFilter === "all" ? undefined : (Number(priorityFilter) as OpportunityPriority),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [statusFilter, typeFilter, priorityFilter, page],
  );

  // Headline totals — four `limit=1` reads so each number is the server's
  // count across every row, not this page's.
  const { reload: reloadCounts, ...countsState } = useAsyncData(async () => {
    const [fresh, doing, done, urgent] = await Promise.all([
      listOpportunities({ status: "new", limit: 1 }),
      listOpportunities({ status: "in_progress", limit: 1 }),
      listOpportunities({ status: "completed", limit: 1 }),
      listOpportunities({ priority: 1, limit: 1 }),
    ]);
    return {
      new: fresh.pagination.total,
      inProgress: doing.pagination.total,
      completed: done.pagination.total,
      highPriority: urgent.pagination.total,
    };
  }, []);
  const counts = countsState.status === "success" ? countsState.data : null;

  const { toast } = useToast();
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<Error | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { reload: reloadRecommendations, ...recommendationsState } = useAsyncData(() => listRecommendations({ limit: 100 }), []);
  const [generatingRecommendationId, setGeneratingRecommendationId] = useState<string | null>(null);
  const [updatingRecommendationId, setUpdatingRecommendationId] = useState<string | null>(null);

  const { reload: reloadPendingActions, ...pendingActionsState } = useAsyncData(() => listPendingActionsByRecommendationId(), []);
  const pendingActionsByRecommendationId: Map<string, { pendingAction: AgentPendingAction; agentRunId: string }> =
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

  const recommendationsByOpportunityId = useMemo(() => {
    const map = new Map<string, Recommendation>();
    if (recommendationsState.status === "success") {
      for (const r of recommendationsState.data.recommendations) map.set(r.opportunityId, r);
    }
    return map;
  }, [recommendationsState]);

  const visibleOpportunities = useMemo(() => {
    if (state.status !== "success") return [];
    return state.data.opportunities.filter((o) => {
      if (impactFilter !== "all" && scoreBand(o.impactScore) !== impactFilter) return false;
      if (effortFilter !== "all" && scoreBand(o.effortScore) !== effortFilter) return false;
      return true;
    });
  }, [state, impactFilter, effortFilter]);

  const serverFiltersActive = statusFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all";
  const bandFiltersActive = impactFilter !== "all" || effortFilter !== "all";
  const filtersActive = serverFiltersActive || bandFiltersActive;

  function clearFilters() {
    setStatusFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
    setImpactFilter("all");
    setEffortFilter("all");
    setPage(1);
  }

  async function handleRecompute() {
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const result = await recomputeOpportunities();
      const { summary } = result;
      const parts: string[] = [];
      if (summary.created) parts.push(`${summary.created} new`);
      if (summary.updated) parts.push(`${summary.updated} updated`);
      if (summary.reactivated) parts.push(`${summary.reactivated} reactivated`);
      toast({
        title: "Opportunities recomputed",
        description:
          parts.length > 0 ? `${parts.join(", ")} across ${summary.intentsConsidered} intents.` : `No changes across ${summary.intentsConsidered} intents.`,
      });
      reload();
      reloadCounts();
    } catch (err) {
      if (err instanceof NoActiveQuerySetError || err instanceof NoBrandProfileError) {
        setRecomputeError(err);
      } else {
        toast({
          title: "Couldn't recompute opportunities",
          description: err instanceof Error ? err.message : "Something went wrong — try again.",
          variant: "danger",
        });
      }
    } finally {
      setRecomputing(false);
    }
  }

  async function handleStatusChange(opportunity: Opportunity, status: OpportunityStatus, dismissalReason?: string) {
    setUpdatingId(opportunity.id);
    try {
      await updateOpportunity(opportunity.id, { status, dismissalReason });
      reload();
      reloadCounts();
      if (status === "dismissed") {
        toast({ title: "Opportunity dismissed", description: `"${opportunity.title}" won't reappear unless the underlying signal changes.` });
      }
    } catch (err) {
      toast({
        title: "Couldn't update that opportunity",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleGenerateRecommendation(opportunity: Opportunity) {
    setGeneratingRecommendationId(opportunity.id);
    try {
      const { created } = await generateRecommendation(opportunity.id);
      reloadRecommendations();
      toast({
        title: created ? "Recommendation generated" : "Recommendation refreshed",
        description: `"${opportunity.title}" now has a next action.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't generate a recommendation",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setGeneratingRecommendationId(null);
    }
  }

  async function handleRecommendationStatusChange(recommendation: Recommendation, status: RecommendationStatus) {
    setUpdatingRecommendationId(recommendation.id);
    try {
      await updateRecommendationStatus(recommendation.id, status);
      reloadRecommendations();
    } catch (err) {
      toast({
        title: "Couldn't update that recommendation",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setUpdatingRecommendationId(null);
    }
  }

  const data = state.status === "success" ? state.data : null;
  const total = data?.pagination.total ?? 0;
  const firstRun = data !== null && total === 0 && !serverFiltersActive;

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="What to do next. Search demand and AI-visibility gaps merged into one ranked list — the strongest moves are where both signals line up, each backed by evidence."
        actions={
          !firstRun ? (
            <Button variant="outline" size="sm" loading={recomputing} onClick={handleRecompute}>
              <RefreshCw size={14} aria-hidden="true" /> Recompute
            </Button>
          ) : undefined
        }
      />

      <PageStack>
        {recomputeError && (
          <Reveal>
            <Card role="alert" className="flex flex-col gap-3 border-warning/40 p-4 sm:flex-row sm:items-start">
              <AlertTriangle className="size-4 shrink-0 text-warning sm:mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  {recomputeError instanceof NoActiveQuerySetError ? "Recompute needs an active query set" : "Recompute needs a brand profile"}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{recomputeError.message}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="self-start">
                <Link href={recomputeError instanceof NoActiveQuerySetError ? "/query-universe" : "/settings"}>
                  {recomputeError instanceof NoActiveQuerySetError ? "Go to Query Universe" : "Go to Settings"}
                </Link>
              </Button>
            </Card>
          </Reveal>
        )}

        {!firstRun && state.status !== "error" && (
          <StatGrid>
            <StatTile
              label="Not started"
              icon={<Inbox size={13} />}
              loading={!counts && countsState.status === "loading"}
              value={counts ? formatNumber(counts.new) : "—"}
              muted={!counts}
              hint="Ready to pick up"
            />
            <StatTile
              label="In progress"
              icon={<CircleDot size={13} />}
              loading={!counts && countsState.status === "loading"}
              value={counts ? formatNumber(counts.inProgress) : "—"}
              muted={!counts}
              hint="Being worked on"
            />
            <StatTile
              label="Completed"
              icon={<CheckCircle2 size={13} />}
              loading={!counts && countsState.status === "loading"}
              value={counts ? formatNumber(counts.completed) : "—"}
              muted={!counts}
              hint="Marked done"
            />
            <StatTile
              label="High priority"
              icon={<Flag size={13} />}
              loading={!counts && countsState.status === "loading"}
              value={counts ? formatNumber(counts.highPriority) : "—"}
              muted={!counts}
              hint="Opportunity score 60+"
            />
          </StatGrid>
        )}

        {!firstRun && (
          <Toolbar
            end={
              data ? (
                <>
                  {bandFiltersActive && (
                    <span className="text-[12px] text-muted-foreground">{formatNumber(visibleOpportunities.length)} shown on this page ·</span>
                  )}
                  <ResultCount count={total} noun="opportunity" pluralNoun="opportunities" />
                </>
              ) : undefined
            }
          >
            <FilterSelect
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
              label="Filter by type"
            />
            <FilterSelect
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              label="Filter by status"
              className="sm:w-36"
            />
            <FilterSelect
              value={priorityFilter}
              onValueChange={(v) => {
                setPriorityFilter(v);
                setPage(1);
              }}
              options={PRIORITY_OPTIONS}
              label="Filter by priority"
              className="sm:w-36"
            />
            <FilterSelect value={impactFilter} onValueChange={setImpactFilter} options={IMPACT_OPTIONS} label="Filter by impact (this page)" className="sm:w-36" />
            <FilterSelect value={effortFilter} onValueChange={setEffortFilter} options={EFFORT_OPTIONS} label="Filter by effort (this page)" className="sm:w-36" />
            {filtersActive && <ClearFiltersButton onClick={clearFilters} />}
          </Toolbar>
        )}

        {state.status === "loading" && (
          <Reveal>
            <Card className="divide-y divide-border overflow-hidden" aria-busy="true">
              <span className="sr-only">Loading opportunities…</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4 px-5 py-4" aria-hidden="true">
                  <Skeleton className="h-6 w-10" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-48 rounded-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <div className="hidden w-60 flex-col gap-2 md:flex">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <Skeleton key={j} className="h-2 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          </Reveal>
        )}

        {state.status === "error" && (
          <Reveal>
            <ErrorPanel title="Opportunities didn't load" message={state.error.message} onRetry={reload} />
          </Reveal>
        )}

        {firstRun && (
          <Reveal>
            <EmptyState
              icon={<Target size={20} />}
              title="No opportunities yet"
              description="Recompute merges your search-demand keywords (SEO Intelligence) with your AI-visibility gaps (Competitors) into one ranked list. It needs an active query set with keyword or competitor data — usually ready after your first baseline run."
              action={
                <Button variant="primary" size="sm" loading={recomputing} onClick={handleRecompute}>
                  <RefreshCw size={14} aria-hidden="true" /> Recompute opportunities
                </Button>
              }
              secondaryAction={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/seo-intelligence">Add keywords</Link>
                </Button>
              }
            />
          </Reveal>
        )}

        {data && !firstRun && (data.opportunities.length === 0 || visibleOpportunities.length === 0) && (
          <Reveal>
            <NoResults
              noun="opportunities"
              onClear={clearFilters}
              hint={
                data.opportunities.length > 0 && bandFiltersActive
                  ? "Impact and effort filters only narrow the current page. Try another page or clear filters."
                  : "Try a different type, status or priority, or clear filters to see everything."
              }
            />
          </Reveal>
        )}

        {data && visibleOpportunities.length > 0 && (
          <Section
            title="Ranked by opportunity score"
            description="Highest-return moves first. Open Evidence to see exactly why each one scored the way it did."
            flush
          >
            <RefreshOverlay active={state.isRefreshing}>
              <ul className="divide-y divide-border">
                {visibleOpportunities.map((opportunity) => {
                  const recommendation = recommendationsByOpportunityId.get(opportunity.id);
                  const pending = recommendation ? pendingActionsByRecommendationId.get(recommendation.id) : undefined;
                  const rank = (page - 1) * PAGE_SIZE + data.opportunities.indexOf(opportunity) + 1;
                  return (
                    <OpportunityCard
                      key={opportunity.id}
                      opportunity={opportunity}
                      rank={rank}
                      updating={updatingId === opportunity.id}
                      onStatusChange={handleStatusChange}
                      recommendation={recommendation}
                      recommendationLoading={recommendationsState.status === "loading"}
                      generatingRecommendation={generatingRecommendationId === opportunity.id}
                      onGenerateRecommendation={handleGenerateRecommendation}
                      updatingRecommendationStatus={updatingRecommendationId === recommendation?.id}
                      onRecommendationStatusChange={handleRecommendationStatusChange}
                      pendingAction={pending?.pendingAction}
                      onApprovePendingAction={pending ? () => handleApprovePendingAction(pending.agentRunId) : undefined}
                    />
                  );
                })}
              </ul>
              {total > PAGE_SIZE && (
                <div className="border-t border-border px-5 py-3">
                  <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="opportunities" />
                </div>
              )}
            </RefreshOverlay>
          </Section>
        )}

        {data && visibleOpportunities.length === 0 && data.opportunities.length > 0 && total > PAGE_SIZE && (
          <Reveal>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="opportunities" />
          </Reveal>
        )}
      </PageStack>
    </>
  );
}
