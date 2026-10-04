import { AiRunPreconditionError } from "@/data/ai-visibility/client";
import { AiQueryLimitError, CompetitorNotFoundError, CompetitorTrackingLimitError } from "@/data/competitive-intelligence/client";
import { StartErrorAlert } from "@/components/ai-visibility/ai-run-empty-state";

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
        message: "Competitor runs use your brand's active query set — the same one AI Visibility runs. Fix it in Query Universe first.",
        action: { label: "Go to Query Universe", href: "/query-universe" },
      };
    }
    return { title: "Brand profile not found", message: error.message };
  }
  return { title: "Couldn't start the run", message: error instanceof Error ? error.message : "Something went wrong — try again." };
}

/** Inline error for a failed `POST .../ai-runs` on a competitor — typed
 *  error → precise, actionable message, same chrome as the brand's. */
export function CompetitorRunStartError({ error }: { error: unknown }) {
  return <StartErrorAlert {...describe(error)} />;
}
