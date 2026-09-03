import type { Metadata } from "next";
import { ContentView } from "@/components/content/content-view";

export const metadata: Metadata = { title: "Content" };

export default function ContentPage() {
  return <ContentView />;
}
