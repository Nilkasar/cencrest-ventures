import Link from "next/link";
import { ArrowUpRight, Target } from "lucide-react";
import { Badge, EmptyState } from "@bebest/ui";
import { OPPORTUNITY_TYPE_LABEL, PRIORITY_LABEL } from "@/data/opportunities/labels";
import type { Opportunity } from "@/data/opportunities/types";

/**
 * A report's `newOpportunities` — a frozen read of the rows that existed
 * at generation time (they never re-render with a later status/priority).
 * Each row links to the live Opportunities screen to act on it, with the
 * score drawn as a bar so the strongest stand out at a glance.
 */
export function ReportOpportunitiesList({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          compact
          icon={<Target size={18} />}
          title="No new opportunities in this period"
          description="Nothing new surfaced from the SEO + GEO merge within this report's date range."
        />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {opportunities.map((opportunity) => {
        const score = Math.max(0, Math.min(100, opportunity.opportunityScore));
        return (
          <li key={opportunity.id}>
            <Link
              href="/opportunities"
              className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">{opportunity.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" size="sm">
                    {OPPORTUNITY_TYPE_LABEL[opportunity.type]}
                  </Badge>
                  <span className="text-[12px] text-muted-foreground">{PRIORITY_LABEL[opportunity.priority]}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-surface sm:block" aria-hidden="true">
                  <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${score}%` }} />
                </span>
                <span className="w-8 text-right font-mono text-[13px] font-semibold tabular-nums text-foreground">
                  {opportunity.opportunityScore.toFixed(0)}
                  <span className="sr-only"> opportunity score out of 100</span>
                </span>
                <ArrowUpRight size={14} className="text-subtle-foreground transition-colors group-hover:text-accent" aria-hidden="true" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
