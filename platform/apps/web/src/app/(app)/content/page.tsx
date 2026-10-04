import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ContentView } from "@/components/content/content-view";

export const metadata: Metadata = { title: "Content" };

export default function ContentPage() {
  return (
    <>
      <PageHeader
        title="Content"
        description="Briefs carried forward from your recommendations, and the drafts generated from them — each checked for facts, brand voice, duplication, SEO and GEO before you approve it."
      />
      <ContentView />
    </>
  );
}
