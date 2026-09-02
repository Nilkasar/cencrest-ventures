import { Radar } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "AI Visibility" };

export default function AiVisibilityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI Visibility"
        description="What do AI assistants say about me? Score by model, score by intent, the raw response explorer, citation source map, and sentiment all live here."
      />
      <ComingSoon
        icon={<Radar size={20} />}
        eyebrow="AI Visibility"
        title="No AI visibility data yet"
        description="We haven't run your brand through ChatGPT, Claude, Gemini, and Perplexity yet. Once your baseline finishes running (the AI Provider Abstraction and Visibility Engine that produce this), you'll see your score by model, by intent, and every raw response and citation we found."
        epic={7}
        action={
          <StubActionButton
            label="Run baseline"
            message="Baseline runs require Epic 6 (AI Provider Abstraction) and Epic 7 (AI Visibility Engine)."
            variant="primary"
          />
        }
      />
    </>
  );
}
