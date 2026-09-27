import type { Metadata } from "next";
import { SnapshotIntakeView } from "@/components/snapshot/snapshot-intake-view";

export const metadata: Metadata = {
  title: "Free AI + SEO Growth Snapshot",
  description:
    "See a real, computed sample of your AI Visibility Score, SEO health, and the top gaps and priorities worth fixing first.",
};

/**
 * Epic 17 — the public intake page. Server-component wrapper only (so
 * `metadata` can be exported at all — a "use client" file can't carry one);
 * all interactivity lives in `SnapshotIntakeView`.
 */
export default function SnapshotIntakePage() {
  // `max-w-5xl` matches the header and footer in `(marketing)/layout.tsx`. It
  // was `max-w-2xl`, which left the page's one column visibly narrower than
  // the chrome above and below it — a large part of why the page read as empty.
  return (
    <div className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
      <SnapshotIntakeView />
    </div>
  );
}
