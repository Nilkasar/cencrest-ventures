import type { Metadata } from "next";
import { RecommendationsView } from "@/components/recommendations/recommendations-view";

export const metadata: Metadata = { title: "Recommendations" };

export default function RecommendationsPage() {
  return <RecommendationsView />;
}
