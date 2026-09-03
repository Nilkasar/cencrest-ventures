import type { BadgeProps } from "@bebest/ui";
import type { ReportType } from "./types";

/** Display-only label/variant maps for Epic 15's Reports domain — same role
 *  `data/opportunities/labels.ts` plays for Epic 9. */

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  weekly: "Weekly digest",
  monthly: "Monthly performance",
  custom: "Custom report",
  baseline_comparison: "Baseline comparison",
};

export const REPORT_TYPE_DESCRIPTION: Record<ReportType, string> = {
  weekly: "Score deltas, new opportunities, and competitor movement over the last 7 days.",
  monthly: "The same three sections over a 30-day window.",
  custom: "Any date range you choose.",
  baseline_comparison: "Your original baseline vs. where you stand today — the first-value-moment comparison, extended forward.",
};

export const REPORT_TYPE_BADGE_VARIANT: Record<ReportType, NonNullable<BadgeProps["variant"]>> = {
  weekly: "outline",
  monthly: "outline",
  custom: "neutral",
  baseline_comparison: "accent",
};
