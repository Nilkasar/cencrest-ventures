"use client";

import { RouteError } from "@/components/patterns/route-error";

/**
 * Epic 19 (Production Hardening), UI item 1 — the root segment's own
 * boundary (`app/page.tsx`'s redirect to `/overview`, plus anything else
 * not already caught by a more specific `(app)`/`(auth)`/`(marketing)`/
 * `(onboarding)` boundary). Root-layout errors themselves escape past
 * this file to `global-error.tsx`, per Next.js's own error.js file
 * convention ("does not wrap the layout.js above it in the same segment").
 */
export default function RootSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} homeHref="/overview" homeLabel="Go to Overview" />;
}
