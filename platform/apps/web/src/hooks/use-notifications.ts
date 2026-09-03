"use client";

import { useCallback, useEffect, useState } from "react";
import { listNotifications, markNotificationRead } from "@/data/notifications/client";
import type { Notification } from "@/data/notifications/types";

const POLL_INTERVAL_MS = 30_000;

export type NotificationsState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; items: Notification[]; unreadCount: number };

/**
 * Backs the notification bell (`components/shell/notification-bell.tsx`) —
 * loads `GET /notifications` once, then polls every 30s for as long as the
 * app shell is mounted (there's no terminal state to stop on, unlike
 * `use-agent-run.ts`'s run polling: notifications keep arriving for the
 * life of the session). `markRead` optimistically flips the row's
 * `readAt` locally before the request resolves — the same instant-feedback
 * pattern a bell's read state needs, not a `reload()`-and-wait roundtrip —
 * and re-syncs from the server's response so a failed request never leaves
 * the UI lying about what's actually read.
 */
export function useNotifications() {
  const [state, setState] = useState<NotificationsState>({ status: "loading" });

  const load = useCallback(() => {
    listNotifications()
      .then(({ items, unreadCount }) => setState({ status: "ready", items, unreadCount }))
      .catch((error: unknown) => setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) }));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const items = prev.items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n));
        return { status: "ready", items, unreadCount: items.filter((n) => !n.readAt).length };
      });
      try {
        await markNotificationRead(id);
      } finally {
        load();
      }
    },
    [load],
  );

  return { state, markRead, reload: load };
}
