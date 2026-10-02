import type { Metadata } from "next";
import { SnapshotIntakeView } from "@/components/snapshot/snapshot-intake-view";

export const metadata: Metadata = {
  title: "Free AI Visibility Snapshot — BeBest",
  description:
    "See your AI Visibility Score across ChatGPT, Claude, Gemini, and Perplexity. Free, no credit card.",
};

export default function SnapshotIntakePage() {
  return <SnapshotIntakeView />;
}
