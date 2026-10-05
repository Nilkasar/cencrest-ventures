import { Badge, type BadgeProps } from "@bebest/ui";
import { typography } from "@/components/patterns/typography";
import type { AgencyClientRole, AgencyLinkStatus } from "@/data/agency/types";

/** README §6 tones: pending waits on a human (warning), active is the good
 *  outcome, paused/terminated are inert, revoked is an explicit pull. */
const LINK_STATUS_VARIANT: Record<AgencyLinkStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "warning",
  active: "success",
  paused: "neutral",
  terminated: "neutral",
  revoked: "danger",
};

export const LINK_STATUS_LABEL: Record<AgencyLinkStatus, string> = {
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

/** Access level is a category, not a state — outline, no dot. */
export function AgencyRoleBadge({ role, size = "md" }: { role: AgencyClientRole; size?: BadgeProps["size"] }) {
  return (
    <Badge variant="outline" size={size}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** AI Visibility Score — an integer out of 100 in mono (README §8). Only
 *  active links carry a summary; anything else is an em dash. */
export function AvsCell({ score }: { score: number | null }) {
  if (score === null) return <span className="font-mono text-[12.5px] text-subtle-foreground">&mdash;</span>;
  return <span className={typography.numeric}>{Math.round(score)}</span>;
}
