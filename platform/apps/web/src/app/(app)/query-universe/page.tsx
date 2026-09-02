import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { QueryUniverseView } from "@/components/query-universe/query-universe-view";

export const metadata: Metadata = { title: "Query Universe" };

export default function QueryUniversePage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Query Universe"
        description="The buying questions real customers ask — generated from your brand profile across ten intent categories, then curated by you. Shared foundation for AI Visibility (GEO) and SEO Intelligence."
      />
      <QueryUniverseView />
    </>
  );
}
