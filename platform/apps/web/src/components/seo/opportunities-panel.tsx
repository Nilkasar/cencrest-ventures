"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import {
  Card,
  CardContent,
  EmptyState,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { dismissOpportunity, listOpportunities } from "@/data/seo/client";
import type { OpportunityStatus, SeoOpportunity } from "@/data/seo/types";
import { OPPORTUNITY_STATUS_LABEL } from "@/data/seo/labels";
import { OpportunityRow } from "./opportunity-row";

const STATUS_FILTERS: Array<OpportunityStatus | "all"> = ["all", "new", "in_progress", "completed", "dismissed"];
const PAGE_SIZE = 25;

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * `seo_opportunities`, sorted by score — per the epic's UI surface. Sorting
 * is entirely server-side (`data/seo/client.ts`'s `listOpportunities` never
 * re-orders the response); `refreshKey` bumps whenever
 * `KeywordCoveragePanel` generates new keywords (each one creates a scored
 * opportunity server-side), so this list picks those up without the user
 * having to manually reload.
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

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-[16px] font-semibold text-foreground">Opportunities</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Sorted by opportunity score{state.status === "success" ? ` — ${state.data.pagination.total} total` : ""}.
            </p>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as OpportunityStatus | "all");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44" aria-label="Filter by status">
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
        </div>

        {state.status === "loading" && <RowsSkeleton />}

        {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

        {state.status === "success" && state.data.opportunities.length === 0 && (
          <EmptyState
            compact
            icon={<Target size={18} />}
            title={statusFilter === "all" ? "No opportunities yet" : `No ${OPPORTUNITY_STATUS_LABEL[statusFilter].toLowerCase()} opportunities`}
            description={
              statusFilter === "all"
                ? "Generate keywords from your brand profile above — every keyword generated gets a scored opportunity here."
                : "Try a different status."
            }
          />
        )}

        {state.status === "success" && state.data.opportunities.length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {state.data.opportunities.map((opportunity) => (
              <OpportunityRow
                key={opportunity.id}
                opportunity={opportunity}
                dismissing={dismissingId === opportunity.id}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}

        {state.status === "success" && state.data.opportunities.length > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={state.data.pagination.total} onPageChange={setPage} itemLabel="opportunities" />
        )}
      </CardContent>
    </Card>
  );
}
