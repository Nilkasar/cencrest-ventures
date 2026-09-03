"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Target } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
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
import { OpportunityCard } from "./opportunity-card";

const STATUS_FILTERS: Array<OpportunityStatus | "all"> = ["all", "new", "in_progress", "completed", "dismissed"];
const TYPE_FILTERS: Array<OpportunityType | "all"> = ["all", "unified", "seo", "geo", "content", "technical"];
const PRIORITY_FILTERS: Array<OpportunityPriority | "all"> = ["all", 1, 2, 3];
const BAND_FILTERS: Array<ScoreBand | "all"> = ["all", "high", "medium", "low"];
const BAND_LABEL: Record<ScoreBand, string> = { high: "High", medium: "Medium", low: "Low" };

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Epic 9 — Opportunity Engine's "Opportunities" screen
 * (`docs/09-ux/CUSTOMER_JOURNEY.md`: "What should I do next?" — that doc's
 * own framing names this the single most important screen in the product).
 * Calls `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer: `data/opportunities/client.ts`'s `listOpportunities`/
 * `recomputeOpportunities`/`updateOpportunity`.
 *
 * Filtering: `status`/`type`/`priority` are real server-side query params
 * (`GET /brands/me/opportunities`) and trigger a refetch. `effort`/`impact`
 * are NOT — the API has no query params for them (see
 * `data/opportunities/client.ts`'s header) — so those two narrow the
 * already-fetched, real page client-side via `scoreBand`. Documented as a
 * known limitation in this epic's frontend completion doc: narrows only the
 * current page (`limit` below), not the server-side total.
 */
export function OpportunitiesView() {
  const [statusFilter, setStatusFilter] = useState<OpportunityStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<OpportunityType | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<OpportunityPriority | "all">("all");
  const [impactFilter, setImpactFilter] = useState<ScoreBand | "all">("all");
  const [effortFilter, setEffortFilter] = useState<ScoreBand | "all">("all");

  const { reload, ...state } = useAsyncData(
    () =>
      listOpportunities({
        status: statusFilter === "all" ? undefined : statusFilter,
        type: typeFilter === "all" ? undefined : typeFilter,
        priority: priorityFilter === "all" ? undefined : priorityFilter,
        limit: 100,
      }),
    [statusFilter, typeFilter, priorityFilter],
  );

  const { toast } = useToast();
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<Error | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Epic 10 — the "join by opportunityId" the backend's own completion doc
  // documents as this frontend's responsibility (see
  // `docs/epics/10-recommendation-engine-backend.md`'s "known limitations"
  // #1): one extra list fetch, joined client-side, rather than a per-card
  // `N+1` fetch or a change to Epic 9's already-verified list route.
  const { reload: reloadRecommendations, ...recommendationsState } = useAsyncData(
    () => listRecommendations({ limit: 100 }),
    [],
  );
  const [generatingRecommendationId, setGeneratingRecommendationId] = useState<string | null>(null);
  const [updatingRecommendationId, setUpdatingRecommendationId] = useState<string | null>(null);

  // Epic 12 — Level 3's one-click approval, surfaced inline here rather than
  // a separate approval inbox. See `recommendations-view.tsx`'s identical
  // join and `listPendingActionsByRecommendationId`'s header comment for the
  // N+1-over-a-recent-window rationale.
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

  const filtersActive =
    statusFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all" || impactFilter !== "all" || effortFilter !== "all";

  function clearFilters() {
    setStatusFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
    setImpactFilter("all");
    setEffortFilter("all");
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
          parts.length > 0
            ? `${parts.join(", ")} across ${summary.intentsConsidered} intents.`
            : `No changes across ${summary.intentsConsidered} intents.`,
      });
      reload();
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

  const recomputeButton = (
    <Button variant="primary" size="sm" loading={recomputing} onClick={handleRecompute}>
      <RefreshCw size={14} /> Recompute
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Opportunities"
        description="What should I do next? Search demand and AI-visibility gaps merged into one ranked list — the highest-ROI moves are where both signals line up, each backed by evidence."
        actions={recomputeButton}
      />

      {recomputeError && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3">
          <AlertTriangle className="size-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              {recomputeError instanceof NoActiveQuerySetError ? "No active query set" : "Brand profile required"}
            </p>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{recomputeError.message}</p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href={recomputeError instanceof NoActiveQuerySetError ? "/query-universe" : "/settings"}>
                {recomputeError instanceof NoActiveQuerySetError ? "Go to Query Universe" : "Go to Settings"}
              </Link>
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-foreground">Ranked opportunities</h2>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Sorted by opportunity score
                {state.status === "success" ? ` — ${state.data.pagination.total} total` : ""}
                {filtersActive && state.status === "success" ? `, ${visibleOpportunities.length} shown` : ""}.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as OpportunityType | "all")}>
                <SelectTrigger className="w-36 h-8 text-[12.5px]" aria-label="Filter by type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "All types" : OPPORTUNITY_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OpportunityStatus | "all")}>
                <SelectTrigger className="w-36 h-8 text-[12.5px]" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "All statuses" : OPPORTUNITY_STATUS_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(priorityFilter)}
                onValueChange={(v) => setPriorityFilter(v === "all" ? "all" : (Number(v) as OpportunityPriority))}
              >
                <SelectTrigger className="w-32 h-8 text-[12.5px]" aria-label="Filter by priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_FILTERS.map((value) => (
                    <SelectItem key={String(value)} value={String(value)}>
                      {value === "all" ? "All priorities" : PRIORITY_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={impactFilter} onValueChange={(v) => setImpactFilter(v as ScoreBand | "all")}>
                <SelectTrigger className="w-32 h-8 text-[12.5px]" aria-label="Filter by impact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAND_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "Any impact" : `${BAND_LABEL[value]} impact`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={effortFilter} onValueChange={(v) => setEffortFilter(v as ScoreBand | "all")}>
                <SelectTrigger className="w-32 h-8 text-[12.5px]" aria-label="Filter by effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAND_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "Any effort" : `${BAND_LABEL[value]} effort`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {state.status === "loading" && <ListSkeleton />}

          {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

          {state.status === "success" && state.data.opportunities.length === 0 && (
            <EmptyState
              compact
              icon={<Target size={18} />}
              title="No opportunities yet"
              description="Recompute to merge your search-demand keywords (SEO Intelligence) with your AI-visibility gaps (Competitors) into a ranked list. Needs an active query set with keyword and/or competitor data."
              action={recomputeButton}
            />
          )}

          {state.status === "success" && state.data.opportunities.length > 0 && visibleOpportunities.length === 0 && (
            <EmptyState
              compact
              icon={<Target size={18} />}
              title="No opportunities match these filters"
              description="Try a different combination, or clear filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

          {state.status === "success" && visibleOpportunities.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              {visibleOpportunities.map((opportunity) => {
                const recommendation = recommendationsByOpportunityId.get(opportunity.id);
                const pending = recommendation ? pendingActionsByRecommendationId.get(recommendation.id) : undefined;
                return (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
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
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

