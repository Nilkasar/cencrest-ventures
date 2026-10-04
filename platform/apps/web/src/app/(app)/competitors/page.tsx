import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { CompetitorsView } from "@/components/competitors/competitors-view";

export const metadata: Metadata = { title: "Competitors" };

export default function CompetitorsPage() {
  return (
    <>
      <PageHeader
        title="Competitors"
        description="How do you compare? Every competitor is asked the same questions as you, so scores, share of voice and gaps are like-for-like."
      />
      <CompetitorsView />
    </>
  );
}
