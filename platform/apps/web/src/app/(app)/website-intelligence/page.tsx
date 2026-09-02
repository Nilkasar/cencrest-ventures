import type { Metadata } from "next";
import { WebsiteIntelligenceView } from "@/components/website/website-intelligence-view";

export const metadata: Metadata = { title: "Website Intelligence" };

export default function WebsiteIntelligencePage() {
  return <WebsiteIntelligenceView />;
}
