"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { EmptyState, Pagination, RefreshOverlay, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { Section } from "@/components/patterns/section";
import { NoResults } from "@/components/patterns/states";
import { FilterSelect } from "@/components/patterns/toolbar";
import { useAsyncData } from "@/lib/use-async-data";
import { dismissOpportunity, listOpportunities } from "@/data/seo/client";
import type { OpportunityStatus, SeoOpportunity } from "@/data/seo/types";
import { OPPORTUNITY_STATUS_LABEL } from "@/data/seo/labels";
import { formatNumber } from "@/lib/format";
import { OpportunityRow } from "./opportunity-row";

const STATUS_FILTERS: { value: OpportunityStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(["new", "in_progress", "completed", "dismissed"] as const).map((s) => ({ value: s, label: OPPORTUNITY_STATUS_LABEL[s] })),
];
const PAGE_SIZE = 25;

/**
 * `seo_opportunities`, ranked by score server-side (never re-sorted here).
 * `refreshKey` bumps whenever Keyword coverage generates keywords (each
 * creates a scored opportunity), so new rows appear without a reload.
 */
export function OpportunitiesPanel({ refreshKey }: { refreshKey: number }) {
  const [statusFilter, setStatusFilter] = useState<OpportunityStatus | "all">("all");
  const [page, setPage] = useState(1);
  const { reload, ...state } = useAsyncData(
    () =>
      listOpportunities({
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [statusFilter, page, refreshKey],
  );
  const { toast } = useToast();
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function handleDismiss(opportunity: SeoOpportunity) {
    setDismissingId(opportunity.id);
    try {
      await dismissOpportunity(opportunity.id);
      reload();
    } catch {
      toast({ title: "Couldn't dismiss that opportunity", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setDismissingId(null);
    }
  }

  const data = state.status === "success" ? state.data : null;
  const total = data?.pagination.total ?? 0;
  const firstRun = data !== null && total === 0 && statusFilter === "all";
  const rows = data?.opportunities ?? [];

  return (
    <Section
      title="Content opportunities"
      description={
        data && !firstRun
          ? `${formatNumber(total)} ${statusFilter === "all" ? "" : `${OPPORTUNITY_STATUS_LABEL[statusFilter].toLowerCase()} `}keyword opportunit${total === 1 ? "y" : "ies"}, highest score first.`
          : "One scored page idea per keyword, highest score first."
      }
      actions={
        !firstRun ? (
          <FilterSelect
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={STATUS_FILTERS}
            label="Filter opportunities by status"
            className="h-8 w-36 sm:w-40"
          />
        ) : undefined
      }
      flush={rows.length > 0}
    >
      {state.status === "loading" && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Loading opportunities…</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {state.status === "error" && <ErrorPanel compact title="Opportunities didn't load" message={state.error.message} onRetry={reload} />}

      {firstRun && (
        <EmptyState
          compact
          icon={<Target size={18} />}
          title="No content opportunities yet"
          description="Every keyword you generate or add gets a scored page idea here. Generate keywords from your brand profile in Keyword coverage above to get your first list."
        />
      )}

      {data && !firstRun && rows.length === 0 && (
        <NoResults
          noun="opportunities"
          onClear={() => {
            setStatusFilter("all");
            setPage(1);
          }}
          hint="Nothing has this status yet. Try another, or show all."
        />
      )}

      {rows.length > 0 && (
        <RefreshOverlay active={state.isRefreshing}>
          <ul className="divide-y divide-border">
            {rows.map((opportunity, i) => (
              <OpportunityRow
                key={opportunity.id}
                opportunity={opportunity}
                rank={(page - 1) * PAGE_SIZE + i + 1}
                dismissing={dismissingId === opportunity.id}
                onDismiss={handleDismiss}
              />
            ))}
          </ul>
          {total > PAGE_SIZE && (
            <div className="border-t border-border px-5 py-3">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="opportunities" />
            </div>
          )}
        </RefreshOverlay>
      )}
    </Section>
  );
}
