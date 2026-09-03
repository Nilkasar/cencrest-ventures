"use client";

import { RouteError } from "@/components/patterns/route-error";

/**
 * Epic 19 (Production Hardening), UI item 1 — every screen behind
 * `<AppShell>` (Overview, AI Visibility, SEO Intelligence, Competitors,
 * Opportunities, Actions, Content, Reports, Agents, CRM, Query Universe,
 * Settings, Website Intelligence, Agency) had no error boundary at all
 * before this epic: an unhandled render error anywhere in that tree
 * produced a blank screen, not a fallback UI. `error.tsx` wraps
 * `(app)/layout.tsx`'s children only, not the layout itself — so the
 * sidebar/topbar chrome (and its navigation) stays usable, and only the
 * broken screen's content area is replaced.
 */
export default function AppSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      description="This screen hit an unexpected error. Your data is safe — try again, or use the sidebar to go somewhere else while we sort it out."
      homeHref="/overview"
      homeLabel="Go to Overview"
    />
  );
}
