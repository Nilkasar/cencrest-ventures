import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { OverviewView } from "@/components/overview/overview-view";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Overview"
        description="How am I doing? Your whole workspace at a glance — what AI assistants say about you, how you rank, what to do next, and what your work has already moved."
      />
      <OverviewView />
    </>
  );
}
