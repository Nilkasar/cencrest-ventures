import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@bebest/ui";
import { AiRunPreconditionError } from "@/data/ai-visibility/client";
import { AiQueryLimitError, CompetitorNotFoundError, CompetitorTrackingLimitError } from "@/data/competitive-intelligence/client";

function describe(error: unknown): { title: string; message: string; action?: { label: string; href: string } } {
  if (error instanceof CompetitorTrackingLimitError) {
    return { title: "Competitor-tracking limit reached", message: error.message };
  }
  if (error instanceof AiQueryLimitError) {
    return { title: "Monthly AI query limit reached", message: error.message };
  }
  if (error instanceof CompetitorNotFoundError) {
    return { title: "Competitor not found", message: error.message };
  }
  if (error instanceof AiRunPreconditionError) {
    if (error.code === "no_active_query_set" || error.code === "query_set_empty") {
      return {
        title: error.code === "no_active_query_set" ? "No active query set" : "Your active query set is empty",
        message:
          "Competitor runs use your brand's active query set — the same one AI Visibility runs. Fix it in Query Universe first.",
        action: { label: "Go to Query Universe", href: "/query-universe" },
      };
    }
    return { title: "Brand profile not found", message: error.message };
  }
  return { title: "Couldn't start the run", message: error instanceof Error ? error.message : "Something went wrong — try again." };
}

/** Inline error surface for a failed `POST .../ai-runs` — same "typed error
 *  -> precise, actionable message" pattern `AiRunEmptyState` uses for the
 *  brand run, sized for a competitor card rather than a full-page empty
 *  state. */
export function CompetitorRunStartError({ error }: { error: unknown }) {
  const { title, message, action } = describe(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3">
      <AlertTriangle className="size-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[12.5px] text-muted-foreground mt-0.5">{message}</p>
        {action && (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
