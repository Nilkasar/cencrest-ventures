import { Badge, type BadgeProps } from "@bebest/ui";
import type { CrawlJobStatus, IssueSeverity } from "@/data/website/types";
import { SEVERITY_LABEL, STATUS_LABEL } from "@/data/website/labels";

/**
 * Website Intelligence's status → tone map, in one place (patterns README
 * §6). Crawl status: running is "in motion, nobody needs to act" (info);
 * failed is a bad outcome (danger). Severity: high is "fix this" (danger),
 * medium is at-risk (warning), low is inert (neutral).
 */
const CRAWL_STATUS_TONE: Record<CrawlJobStatus, NonNullable<BadgeProps["variant"]>> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

const SEVERITY_TONE: Record<IssueSeverity, NonNullable<BadgeProps["variant"]>> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

/** Chart fills for severity — the same three the Overview's severity ring
 *  uses, so the dashboard tile and this page read as one encoding. */
export const SEVERITY_FILL: Record<IssueSeverity, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-info",
};

export const SEVERITIES: IssueSeverity[] = ["high", "medium", "low"];

export function CrawlStatusBadge({ status, size = "sm" }: { status: CrawlJobStatus; size?: "sm" | "md" }) {
  return (
    <Badge variant={CRAWL_STATUS_TONE[status]} size={size} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity, size = "sm" }: { severity: IssueSeverity; size?: "sm" | "md" }) {
  return (
    <Badge variant={SEVERITY_TONE[severity]} size={size} dot>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function formatCrawlDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
