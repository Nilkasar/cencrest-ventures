"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Skeleton, cn } from "@bebest/ui";
import { NOTIFICATION_TYPE_ICON, NOTIFICATION_TYPE_LABEL } from "@/data/notifications/labels";
import type { Notification } from "@/data/notifications/types";
import { useNotifications } from "@/hooks/use-notifications";
import { formatRelativeTime } from "@/lib/format";

/**
 * The bell-icon notification center (Epic 15's UI-surface requirement, in
 * the Epic 0 app shell) — every in-app notification the shared `notify()`
 * function has ever written for this org/user, newest first, with
 * mark-as-read. Lives in `Topbar` next to `ThemeToggle`/`UserMenu`, same
 * "always reachable from anywhere in the app" placement those get.
 */
export function NotificationBell() {
  const { state, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const unreadCount = state.status === "ready" ? state.unreadCount : 0;
  const markableUnread = state.status === "ready" ? state.items.filter((n) => n.userId !== null && !n.readAt) : [];

  async function handleMarkAllRead() {
    await Promise.all(markableUnread.map((n) => markRead(n.id)));
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative"
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[9.5px] font-semibold leading-none text-ink-0"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="font-display text-[14px] font-semibold text-foreground">Notifications</p>
          {markableUnread.length > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent hover:bg-accent-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {state.status === "loading" && (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {state.status === "error" && (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">Couldn&apos;t load notifications.</p>
          )}

          {state.status === "ready" && state.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Bell size={20} className="text-subtle-foreground" aria-hidden="true" />
              <p className="text-[13px] font-medium text-foreground">You&apos;re all caught up</p>
              <p className="text-[12px] text-muted-foreground max-w-[260px]">
                Report-ready notices, competitor movement, and agent activity will show up here.
              </p>
            </div>
          )}

          {state.status === "ready" &&
            state.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onMarkRead={() => void markRead(notification.id)}
                onNavigate={() => setOpen(false)}
              />
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
  onNavigate,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onNavigate: () => void;
}) {
  const Icon = NOTIFICATION_TYPE_ICON[notification.type];
  const unread = notification.readAt === null;
  const canMarkRead = unread && notification.userId !== null;

  const body = (
    <div className="flex gap-3 min-w-0 flex-1">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border",
          unread ? "border-accent/30 bg-accent-muted text-accent" : "border-border bg-surface text-muted-foreground",
        )}
        title={NOTIFICATION_TYPE_LABEL[notification.type]}
        aria-hidden="true"
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={cn("text-[12.5px] leading-snug", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>
            {notification.title}
          </p>
          {unread && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />}
        </div>
        {notification.body && <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">{notification.body}</p>}
        <div className="mt-1 flex items-center gap-2">
          <p className="font-mono text-[10.5px] text-subtle-foreground">{formatRelativeTime(notification.createdAt)}</p>
          {notification.userId === null && (
            <Badge variant="outline" size="sm" className="h-4 px-1.5 text-[9px]">
              Org-wide
            </Badge>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("flex items-start gap-2 border-b border-border px-4 py-3 last:border-b-0", unread && "bg-accent-muted/25")}>
      {notification.actionUrl ? (
        <Link href={notification.actionUrl} onClick={onNavigate} className="flex min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </Link>
      ) : (
        body
      )}
      {canMarkRead && (
        <button
          type="button"
          onClick={onMarkRead}
          aria-label="Mark as read"
          title="Mark as read"
          className="mt-0.5 shrink-0 rounded-md p-1.5 text-subtle-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Check size={13} />
        </button>
      )}
    </div>
  );
}
