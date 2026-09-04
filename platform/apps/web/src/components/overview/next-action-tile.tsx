"use client";

import { AlertTriangle, ListChecks, Sparkles } from "lucide-react";
import { Badge } from "@bebest/ui";
import { useAsyncData } from "@/lib/use-async-data";
import { getActionsOverview } from "@/data/actions/client";
import type { ActionPriority, ActionWithContext } from "@/data/actions/types";
import { ACTION_PRIORITY_BADGE_VARIANT, ACTION_PRIORITY_LABEL } from "@/data/actions/labels";
import { listRecommendations } from "@/data/recommendations/client";
import { ACTION_TYPE_BADGE_VARIANT, ACTION_TYPE_LABEL } from "@/data/recommendations/labels";
import { StatTile, StatTileSkeleton } from "./stat-tile";

/** `ActionPriority`'s real 1-3-plus-critical ladder, ranked so "highest
 *  priority" has an unambiguous answer — `GET /brands/me/actions` sorts its
 *  `pending` section by `created_at` desc only (see
 *  `apps/api/src/routes/actions.ts`), not by priority, so this tile does
 *  the priority ordering `docs/epics/10-recommendation-engine-backend.md`'s
 *  `priorityRank` already does server-side for recommendations. */
const PRIORITY_WEIGHT: Record<ActionPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Highest-priority pending approval, newest first within a tie (the array
 *  arrives already `created_at` desc — `Array.prototype.sort` is stable, so
 *  that ordering survives inside each priority tier). `null` when nothing
 *  is pending. */
function topPendingAction(pending: ActionWithContext[]): ActionWithContext | null {
  if (pending.length === 0) return null;
  return [...pending].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority])[0]!;
}

/**
 * "What should I do next?" (singular) — the Overview's headline next step.
 * Reuses `getActionsOverview()` (`data/actions/client.ts`) and
 * `listRecommendations()` (`data/recommendations/client.ts`) — the same
 * real routes the `/actions` and `/recommendations` screens call, no
 * parallel fetch logic.
 *
 * Precedence: a PENDING APPROVAL wins over a plain recommendation whenever
 * one exists — it's already been turned into a concrete, reviewed action
 * waiting on a single click (approve), the most "shovel-ready" thing a
 * user can do, versus a recommendation that hasn't been actioned into
 * anything yet. Within pending approvals, the highest `priority` wins
 * (`topPendingAction` above). Only when nothing is pending does this fall
 * back to the single highest-`priorityRank` open recommendation — fetched
 * with `status: "new", limit: 1` so the API's own real sort
 * (`priorityRank` desc, `routes/recommendations.ts`) picks the top one,
 * never re-derived client-side.
 */
export function NextActionTile() {
  const state = useAsyncData(async () => {
    const [overview, recPage] = await Promise.all([
      getActionsOverview(),
      listRecommendations({ status: "new", limit: 1 }),
    ]);
    return {
      pendingAction: topPendingAction(overview.pending),
      recommendation: recPage.recommendations[0] ?? null,
    };
  }, []);

  if (state.status === "loading") return <StatTileSkeleton />;

  if (state.status === "error") {
    return (
      <StatTile href="/actions" eyebrow="Next action" icon={<ListChecks size={13} />}>
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle size={16} aria-hidden="true" />
          <p className="text-[12.5px]">Couldn&rsquo;t load — tap to view</p>
        </div>
      </StatTile>
    );
  }

  const { pendingAction, recommendation } = state.data;

  if (pendingAction) {
    return (
      <StatTile href="/actions" eyebrow="Next action" icon={<ListChecks size={13} />}>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <Badge variant={ACTION_PRIORITY_BADGE_VARIANT[pendingAction.priority]} size="sm">
            {ACTION_PRIORITY_LABEL[pendingAction.priority]}
          </Badge>
          <Badge variant="warning" size="sm">
            Awaiting your approval
          </Badge>
        </div>
        <p className="text-[13.5px] font-medium text-foreground leading-snug line-clamp-2">{pendingAction.title}</p>
      </StatTile>
    );
  }

  if (recommendation) {
    return (
      <StatTile href="/recommendations" eyebrow="Next action" icon={<Sparkles size={13} />}>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <Badge variant={ACTION_TYPE_BADGE_VARIANT[recommendation.actionType]} size="sm">
            {ACTION_TYPE_LABEL[recommendation.actionType]}
          </Badge>
        </div>
        <p className="text-[13.5px] font-medium text-foreground leading-snug line-clamp-2">{recommendation.title}</p>
      </StatTile>
    );
  }

  return (
    <StatTile href="/opportunities" eyebrow="Next action" icon={<Sparkles size={13} />}>
      <p className="font-mono text-[18px] font-semibold text-muted-foreground leading-none">Nothing yet</p>
      <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
        Recommendations are generated from an opportunity&rsquo;s evidence — open Opportunities and generate a next
        action to see it here.
      </p>
    </StatTile>
  );
}
