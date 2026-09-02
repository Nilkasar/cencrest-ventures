import type { Metadata } from "next";
import { CompetitorsView } from "@/components/competitors/competitors-view";

export const metadata: Metadata = { title: "Competitors" };

export default function CompetitorsPage() {
  return <CompetitorsView />;
}
