import type { ReactNode } from "react";
import { Badge, EmptyState } from "@bebest/ui";

/**
 * Standard placeholder body for a nav destination that has no data yet.
 * Every one of these follows the CUSTOMER_JOURNEY.md empty-state contract:
 * explain why it's empty, say what happens next, make the next action
 * reachable (even if that action is just "here's where evidence will
 * appear once Epic N ships").
 */
export function ComingSoon({
  icon,
  eyebrow,
  title,
  description,
  epic,
  action,
  secondaryAction,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  epic?: number;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      {typeof epic === "number" && (
        <Badge variant="outline" size="sm">
          Ships in Epic {epic}
        </Badge>
      )}
      <EmptyState
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
        secondaryAction={secondaryAction}
        className="w-full"
      />
    </div>
  );
}
