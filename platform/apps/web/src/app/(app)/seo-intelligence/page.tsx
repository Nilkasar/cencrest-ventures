import type { Metadata } from "next";
import { SeoIntelligenceView } from "@/components/seo/seo-intelligence-view";

export const metadata: Metadata = { title: "SEO Intelligence" };

export default function SeoIntelligencePage() {
  return <SeoIntelligenceView />;
}
