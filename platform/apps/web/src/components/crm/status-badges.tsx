import { Badge, type BadgeProps } from "@bebest/ui";
import type { DealStage, LeadSource, LeadStatus } from "@/data/crm/types";
import { DEAL_STAGE_LABEL } from "@/data/crm/types";

const LEAD_STATUS_VARIANT: Record<LeadStatus, BadgeProps["variant"]> = {
  new: "neutral",
  contacted: "outline",
  qualified: "warning",
  converted: "success",
  lost: "danger",
};

const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};

export function LeadStatusBadge({ status, size = "md" }: { status: LeadStatus; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={LEAD_STATUS_VARIANT[status]} size={size} dot>
      {LEAD_STATUS_LABEL[status]}
    </Badge>
  );
}

const DEAL_STAGE_VARIANT: Record<DealStage, BadgeProps["variant"]> = {
  new: "neutral",
  qualifying: "outline",
  proposal: "warning",
  negotiation: "warning",
  won: "success",
  lost: "danger",
};

export function DealStageBadge({ stage, size = "md" }: { stage: DealStage; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={DEAL_STAGE_VARIANT[stage]} size={size} dot>
      {DEAL_STAGE_LABEL[stage]}
    </Badge>
  );
}

const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  free_snapshot: "Free snapshot",
  apply_form: "Apply form",
  direct: "Direct",
  referral: "Referral",
};

export function LeadSourceBadge({ source, size = "md" }: { source: LeadSource; size?: BadgeProps["size"] }) {
  return (
    <Badge variant="outline" size={size}>
      {LEAD_SOURCE_LABEL[source]}
    </Badge>
  );
}

/** Score is a measurement, not a label — rendered as mono text with a
 *  color band instead of a badge, per DESIGN.md's typography rationale. */
export function LeadScore({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="font-mono text-[12.5px] text-subtle-foreground">—</span>;
  }
  const tone = score >= 70 ? "text-success" : score >= 40 ? "text-foreground" : "text-muted-foreground";
  return <span className={`font-mono text-[12.5px] font-medium ${tone}`}>{score}</span>;
}
