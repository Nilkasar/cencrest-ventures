import { Gauge } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Overview"
        description="How am I doing? Your AI Visibility Score, SEO Health Score, active opportunities, and next recommended action will live here once your baseline exists."
      />
      <ComingSoon
        icon={<Gauge size={20} />}
        eyebrow="Overview"
        title="Your AI Visibility Baseline hasn't started yet"
        description="Once onboarding runs — brand setup, then a full query run across ChatGPT, Claude, Gemini, and Perplexity — this page becomes your at-a-glance answer to “how am I doing?”: score trend, active opportunities, recent actions, and the single next thing to do."
        epic={2}
        action={
          <StubActionButton
            label="Start onboarding"
            message="Onboarding kicks off once Epic 0's backend and Epic 2 (Brand Intelligence) intake exist."
            variant="primary"
          />
        }
      />
    </>
  );
}
