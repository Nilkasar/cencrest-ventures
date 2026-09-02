import type { Metadata } from "next";
import { AiVisibilityView } from "@/components/ai-visibility/ai-visibility-view";

export const metadata: Metadata = { title: "AI Visibility" };

export default function AiVisibilityPage() {
  return <AiVisibilityView />;
}
