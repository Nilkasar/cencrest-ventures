import type { Metadata } from "next";
import { OverviewView } from "@/components/overview/overview-view";

export const metadata: Metadata = { title: "Overview" };

/** No visible page header — the topbar breadcrumb already says "Overview",
 *  so the dashboard starts straight at the AI Visibility deck. The h1 stays
 *  for screen readers and document outline. */
export default function OverviewPage() {
  return (
    <>
      <h1 className="sr-only">Overview</h1>
      <OverviewView />
    </>
  );
}
