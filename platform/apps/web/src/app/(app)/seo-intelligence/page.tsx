import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { SeoIntelligenceView } from "@/components/seo/seo-intelligence-view";

export const metadata: Metadata = { title: "SEO Intelligence" };

export default function SeoIntelligencePage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="SEO Intelligence"
        description="Where do I stand in search? Technical health, keyword coverage, and scored content opportunities from your brand's crawled pages."
      />
      <SeoIntelligenceView />
    </>
  );
}
