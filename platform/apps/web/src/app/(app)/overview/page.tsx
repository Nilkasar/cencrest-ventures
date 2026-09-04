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
        description="How am I doing? Your AI Visibility Score, SEO Health, active opportunities, and the single next thing to do."
      />
      <OverviewView />
    </>
  );
}
