import { Search } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "SEO Intelligence" };

export default function SeoIntelligencePage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="SEO Intelligence"
        description="Where do I stand in search? Technical health, keyword coverage, content gaps, and internal link opportunities live here once your site's been crawled."
      />
      <ComingSoon
        icon={<Search size={20} />}
        eyebrow="SEO Intelligence"
        title="No SEO analysis yet"
        description="Connect your website and we'll crawl it for technical health, keyword coverage, content gaps, and page-level issues — safely, respecting robots.txt and rate limits."
        epic={4}
        action={
          <StubActionButton
            label="Connect website"
            message="Website crawling ships with Epic 3 (Website Intelligence) and scoring with Epic 4 (SEO Intelligence)."
            variant="primary"
          />
        }
      />
    </>
  );
}
