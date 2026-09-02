import { Mail, MessageSquare, Phone, Radar, UserCheck } from "lucide-react";
import { EmptyState } from "@bebest/ui";
import type { Activity, ActivityType } from "@/data/crm/types";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

const ACTIVITY_ICON: Record<ActivityType, typeof Mail> = {
  note: MessageSquare,
  email: Mail,
  call: Phone,
  snapshot_requested: Radar,
  signup: UserCheck,
};

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: "Note",
  email: "Email",
  call: "Call",
  snapshot_requested: "Snapshot requested",
  signup: "Signup",
};

/** Timestamped history for a lead, account, or (via metadata.dealId) a
 *  deal — newest first. Used on every detail screen the spec calls for a
 *  "history" answer. */
export function ActivityTimeline({ activities, emptyHint }: { activities: Activity[]; emptyHint: string }) {
  if (activities.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare size={18} />}
        title="No activity yet"
        description={emptyHint}
        compact
      />
    );
  }

  return (
    <ol className="flex flex-col">
      {activities.map((activity, index) => {
        const Icon = ACTIVITY_ICON[activity.type];
        const isLast = index === activities.length - 1;
        return (
          <li key={activity.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
                <Icon size={13} aria-hidden="true" />
              </span>
              {!isLast && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
            <div className={isLast ? "pb-1 min-w-0 flex-1" : "pb-5 min-w-0 flex-1"}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-[13px] font-medium text-foreground">{activity.subject}</p>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-subtle-foreground">
                  {ACTIVITY_LABEL[activity.type]}
                </span>
              </div>
              {activity.body && (
                <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">{activity.body}</p>
              )}
              <p className="text-[12px] text-subtle-foreground mt-1" title={formatDateTime(activity.createdAt)}>
                {activity.actor ? `${activity.actor.name} · ` : ""}
                {formatRelativeTime(activity.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
