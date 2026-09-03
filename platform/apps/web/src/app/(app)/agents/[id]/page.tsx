import type { Metadata } from "next";
import { AgentRunDetailView } from "@/components/agents/agent-run-detail-view";

export const metadata: Metadata = { title: "Agent run" };

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentRunDetailView runId={id} />;
}
