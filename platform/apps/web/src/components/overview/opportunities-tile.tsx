"use client";

import { AlertTriangle, Target } from "lucide-react";
import { useAsyncData } from "@/lib/use-async-data";
import { listOpportunities } from "@/data/opportunities/client";
import { StatTile, StatTileSkeleton } from "./stat-tile";

/**
 * "What should I do next?" (rolled up) — the active-opportunities count.
 * Reuses `listOpportunities()` (`data/opportunities/client.ts`), the same
 * real `GET /brands/me/opportunities` `/opportunities` itself calls — two
 * cheap `limit: 1` calls (one per status) so this tile only needs each
 * status's real, server-computed `pagination.total`, never the full page of
 * rows `/opportunities` fetches for its list. "Active" = `new` +
 * `in_progress` (the two statuses that still need attention); `completed`/
 * `dismissed` are deliberately excluded, matching how the Opportunities
 * screen's own status filter groups them.
 */
export function OpportunitiesTile() {
  const state = useAsyncData(async () => {
    const [openPage, inProgressPage] = await Promise.all([
      listOpportunities({ status: "new", limit: 1 }),
      listOpportunities({ status: "in_progress", limit: 1 }),
    ]);
    return {
      open: openPage.pagination.total,
      inProgress: inProgressPage.pagination.total,
      active: openPage.pagination.total + inProgressPage.pagination.total,
    };
  }, []);

  if (state.status === "loading") return <StatTileSkeleton />;

  if (state.status === "error") {
    return (
      <StatTile href="/opportunities" eyebrow="Opportunities" icon={<Target size={13} />}>
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle size={16} aria-hidden="true" />
          <p className="text-[12.5px]">Couldn&rsquo;t load — tap to view</p>
        </div>
      </StatTile>
    );
  }

  const { active, open, inProgress } = state.data;

  if (active === 0) {
    return (
      <StatTile href="/opportunities" eyebrow="Opportunities" icon={<Target size={13} />}>
        <p className="font-mono text-[32px] font-semibold text-muted-foreground leading-none">0</p>
        <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
          We&rsquo;re still analyzing your brand. Recompute once your baseline is ready, or add more competitors to find
          more gaps.
        </p>
      </StatTile>
    );
  }

  return (
    <StatTile href="/opportunities" eyebrow="Opportunities" icon={<Target size={13} />}>
      <p className="font-mono text-[32px] font-semibold text-foreground leading-none">{active}</p>
      <p className="text-[12px] text-muted-foreground mt-2">
        {open} new{inProgress > 0 ? ` · ${inProgress} in progress` : ""}
      </p>
    </StatTile>
  );
}
