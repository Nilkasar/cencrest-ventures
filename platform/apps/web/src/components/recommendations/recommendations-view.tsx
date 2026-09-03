"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { listRecommendations, updateRecommendationStatus } from "@/data/recommendations/client";
import type { Recommendation, RecommendationActionType, RecommendationStatus } from "@/data/recommendations/types";
import { ACTION_TYPE_LABEL, RECOMMENDATION_STATUS_LABEL } from "@/data/recommendations/labels";
import { RecommendationCard } from "./recommendation-card";

const STATUS_FILTERS: Array<RecommendationStatus | "all"> = ["all", "new", "in_progress", "completed", "dismissed"];
const ACTION_TYPE_FILTERS: Array<RecommendationActionType | "all"> = ["all", "create_page", "update_page", "fix_technical", "build_citations"];
const SHOW_OPTIONS = [10, 25, 50] as const;

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Epic 10 (Recommendation Engine)'s own screen —
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s onboarding Step 6 ("first 3
 * recommendations") and Stage 4 dashboard's "top 10 prioritized
 * recommendations" experience, per the epic's UI-surface requirement. Calls
 * `platform/apps/api`'s real, tested `GET /brands/me/recommendations` and
 * `PATCH /recommendations/:id` from the first line, no fixture layer.
 *
 * Sorted by `priorityRank` desc server-side, never re-sorted client-side.
 * Defaults to the top 10 (`show` below) — matching the journey doc's own
 * framing of a short, prioritized list rather than an undifferentiated
 * backlog — with a "Show" control to widen the window when browsing
 * everything, not just the top slice.
 */
export function RecommendationsView() {
  const [statusFilter, setStatusFilter] = useState<RecommendationStatus | "all">("all");
  const [actionTypeFilter, setActionTypeFilter] = useState<RecommendationActionType | "all">("all");
  const [show, setShow] = useState<(typeof SHOW_OPTIONS)[number]>(10);

  const { reload, ...state } = useAsyncData(
    () =>
      listRecommendations({
        status: statusFilter === "all" ? undefined : statusFilter,
        actionType: actionTypeFilter === "all" ? undefined : actionTypeFilter,
        limit: show,
      }),
    [statusFilter, actionTypeFilter, show],
  );

  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const filtersActive = statusFilter !== "all" || actionTypeFilter !== "all";

  function clearFilters() {
    setStatusFilter("all");
    setActionTypeFilter("all");
  }

  async function handleStatusChange(recommendation: Recommendation, status: RecommendationStatus) {
    setUpdatingId(recommendation.id);
    try {
      await updateRecommendationStatus(recommendation.id, status);
      reload();
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

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Recommendations"
        description="The exact next move for each opportunity — a specific page to build, gap to fix, or citation to earn, briefed with both SEO and GEO requirements and the evidence behind it. Prioritized so the cheap, high-impact moves surface first."
      />

      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-foreground">Prioritized recommendations</h2>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Sorted by priority rank
                {state.status === "success" ? ` — ${state.data.pagination.total} total` : ""}.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={actionTypeFilter} onValueChange={(v) => setActionTypeFilter(v as RecommendationActionType | "all")}>
                <SelectTrigger className="w-40 h-8 text-[12.5px]" aria-label="Filter by action type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPE_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "All action types" : ACTION_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RecommendationStatus | "all")}>
                <SelectTrigger className="w-36 h-8 text-[12.5px]" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "All statuses" : RECOMMENDATION_STATUS_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(show)} onValueChange={(v) => setShow(Number(v) as (typeof SHOW_OPTIONS)[number])}>
                <SelectTrigger className="w-32 h-8 text-[12.5px]" aria-label="Number to show">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOW_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      Top {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {state.status === "loading" && <ListSkeleton />}

          {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

          {state.status === "success" && state.data.recommendations.length === 0 && !filtersActive && (
            <EmptyState
              compact
              icon={<Sparkles size={18} />}
              title="No recommendations yet"
              description="Recommendations are generated from an opportunity's evidence. Open an opportunity on the Opportunities screen and generate its next action to see it here."
            />
          )}

          {state.status === "success" && state.data.recommendations.length === 0 && filtersActive && (
            <EmptyState
              compact
              icon={<Sparkles size={18} />}
              title="No recommendations match these filters"
              description="Try a different combination, or clear filters to see everything."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

          {state.status === "success" && state.data.recommendations.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              {state.data.recommendations.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  updating={updatingId === recommendation.id}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
