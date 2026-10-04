import { Badge, type BadgeProps, cn } from "@bebest/ui";
import type { CompetitorPriority } from "@/data/types";
import type { GapSeverity, GapType, MovementDirection } from "@/data/competitive-intelligence/types";
import { COMPETITOR_PRIORITY_LABEL } from "@/data/brand-constants";
import { GAP_SEVERITY_LABEL, GAP_TYPE_LABEL, MOVEMENT_DIRECTION_LABEL } from "@/data/competitive-intelligence/labels";

/**
 * The Competitors domain's badge map, in one place (README §6). Priority
 * and gap type are categorical tags (outline, no dot); severity and
 * movement are statuses read by meaning — a competitor climbing is a risk
 * to you (warning), one falling is good news (success).
 */
type Variant = NonNullable<BadgeProps["variant"]>;

export function PriorityBadge({ priority, size = "sm" }: { priority: CompetitorPriority; size?: "sm" | "md" }) {
  return (
    <Badge variant="outline" size={size}>
      {COMPETITOR_PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export function GapTypeBadge({ type }: { type: GapType }) {
  return (
    <Badge variant="outline" size="sm">
      {GAP_TYPE_LABEL[type]}
    </Badge>
  );
}

const SEVERITY_TONE: Record<GapSeverity, Variant> = { high: "danger", medium: "warning" };

export function SeverityBadge({ severity }: { severity: GapSeverity }) {
  return (
    <Badge variant={SEVERITY_TONE[severity]} size="sm" dot>
      {GAP_SEVERITY_LABEL[severity]}
    </Badge>
  );
}

const MOVEMENT_TONE: Record<MovementDirection, Variant> = { increase: "warning", decrease: "success", flat: "neutral" };

export function MovementBadge({ direction, size = "sm" }: { direction: MovementDirection; size?: "sm" | "md" }) {
  return (
    <Badge variant={MOVEMENT_TONE[direction]} size={size} dot>
      {MOVEMENT_DIRECTION_LABEL[direction]}
    </Badge>
  );
}

/**
 * A competitor's AVS minus yours, read from your side: positive means
 * they're ahead (bad for you), negative means you lead. Tone follows that
 * meaning, and the words carry it too, so it's never colour alone.
 */
export function GapValue({ gap, className }: { gap: number | null; className?: string }) {
  if (gap === null) return <span className={cn("text-subtle-foreground", className)}>&mdash;</span>;
  const abs = Math.abs(gap).toFixed(1);
  if (Number(abs) === 0) return <span className={cn("font-mono text-[12.5px] tabular-nums text-muted-foreground", className)}>Tied</span>;
  return (
    <span className={cn("whitespace-nowrap font-mono text-[12.5px] tabular-nums", gap > 0 ? "text-danger" : "text-success", className)}>
      {abs} <span className="font-sans text-[12px]">{gap > 0 ? "ahead" : "behind"}</span>
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

export function displayDomain(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
