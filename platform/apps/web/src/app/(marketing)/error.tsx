"use client";

import { RouteError } from "@/components/patterns/route-error";

/** Epic 19, UI item 1 — covers the free-snapshot flow (`/snapshot`,
 *  `/snapshot/[token]`), the highest-traffic unauthenticated surface in
 *  this app (public lead capture) and the one that most needed a real
 *  fallback instead of a blank page for a first-time visitor. */
export default function MarketingSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      description="Something went wrong loading this page. Try again, or start a new snapshot."
      homeHref="/snapshot"
      homeLabel="Start over"
    />
  );
}
