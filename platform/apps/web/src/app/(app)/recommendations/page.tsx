import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { RecommendationsView } from "@/components/recommendations/recommendations-view";

export const metadata: Metadata = { title: "Recommendations" };

export default function RecommendationsPage() {
  return (
    <>
      <PageHeader
        title="Recommendations"
        description="The exact next move for each opportunity — a page to build, a gap to fix, or a citation to earn — briefed with SEO and GEO requirements and the evidence behind it."
      />
      <RecommendationsView />
    </>
  );
}
