import { Badge, type BadgeProps } from "@bebest/ui";
import type { AgencyClientRole, AgencyLinkStatus } from "@/data/agency/types";

const LINK_STATUS_VARIANT: Record<AgencyLinkStatus, BadgeProps["variant"]> = {
  pending: "warning",
  active: "success",
  paused: "outline",
  terminated: "neutral",
  revoked: "danger",
};

const LINK_STATUS_LABEL: Record<AgencyLinkStatus, string> = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  terminated: "Terminated",
  revoked: "Revoked",
};

export function AgencyLinkStatusBadge({ status, size = "md" }: { status: AgencyLinkStatus; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={LINK_STATUS_VARIANT[status]} size={size} dot>
      {LINK_STATUS_LABEL[status]}
    </Badge>
  );
}

const ROLE_LABEL: Record<AgencyClientRole, string> = {
  admin: "Admin",
  analyst: "Analyst",
  viewer: "Viewer",
};

export function AgencyRoleBadge({ role, size = "md" }: { role: AgencyClientRole; size?: BadgeProps["size"] }) {
  return (
    <Badge variant="outline" size={size}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** AI Visibility Score is a measurement, not a label — mono text with a
 *  color band, same convention `LeadScore` established for CRM. */
export function AvsCell({ score }: { score: number | null }) {
  if (score === null) return <span className="font-mono text-[12.5px] text-subtle-foreground">—</span>;
  const tone = score >= 70 ? "text-success" : score >= 40 ? "text-foreground" : "text-muted-foreground";
  return <span className={`font-mono text-[12.5px] font-medium ${tone}`}>{score.toFixed(1)}</span>;
}
