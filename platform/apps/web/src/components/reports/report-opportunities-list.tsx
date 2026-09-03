import Link from "next/link";
import { ArrowUpRight, Target } from "lucide-react";
import { Badge, EmptyState } from "@bebest/ui";
import { OPPORTUNITY_TYPE_BADGE_VARIANT, OPPORTUNITY_TYPE_LABEL, PRIORITY_LABEL } from "@/data/opportunities/labels";
import type { Opportunity } from "@/data/opportunities/types";

/**
 * A report's `newOpportunities` section — a frozen READ of the
 * `unified_opportunities` rows that existed at generation time (this
 * epic's immutability non-negotiable: these entries never re-render with a
 * status/priority the opportunity may since have moved to). Links out to
 * the live Opportunities screen to actually act on one, rather than
 * offering status/priority controls here that would silently drift from
 * what the frozen snapshot says.
 */
export function ReportOpportunitiesList({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Target size={18} />}
        title="No new opportunities in this period"
        description="Nothing new surfaced from the SEO + GEO merge within this report's date range."
      />
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
      {opportunities.map((opportunity) => (
        <Link
          key={opportunity.id}
          href="/opportunities"
          className="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground truncate">{opportunity.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={OPPORTUNITY_TYPE_BADGE_VARIANT[opportunity.type]} size="sm">
                {OPPORTUNITY_TYPE_LABEL[opportunity.type]}
              </Badge>
              <span className="text-[11.5px] text-subtle-foreground">{PRIORITY_LABEL[opportunity.priority]}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <p className="font-mono text-[15px] font-semibold text-foreground">{opportunity.opportunityScore.toFixed(0)}</p>
            <ArrowUpRight size={14} className="text-subtle-foreground group-hover:text-accent transition-colors" />
          </div>
        </Link>
      ))}
    </div>
  );
}
