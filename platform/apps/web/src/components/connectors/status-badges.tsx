import { Badge, type BadgeProps } from "@bebest/ui";
import type { IntegrationStatus } from "@/data/integrations/types";

/** One tone map for a data-source connection (README §6): connected is a
 *  good outcome, not-connected is inert, a rejected token is a failure. */
const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  error: "Needs reconnect",
};

const STATUS_VARIANT: Record<IntegrationStatus, NonNullable<BadgeProps["variant"]>> = {
  connected: "success",
  disconnected: "neutral",
  error: "danger",
};

export function IntegrationStatusBadge({ status, size = "md" }: { status: IntegrationStatus; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
