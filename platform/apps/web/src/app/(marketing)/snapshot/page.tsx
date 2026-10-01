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
  return (
    <div className="h-full flex items-center">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <SnapshotIntakeView />
      </div>
    </div>
  );
}
