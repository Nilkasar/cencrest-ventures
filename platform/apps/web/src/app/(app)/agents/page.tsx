import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { AgentsView } from "@/components/agents/agents-view";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents"
        description="Autonomous runs across your query universe, AI visibility, competitors and opportunities — every step logged, nothing published without your approval."
      />
      <AgentsView />
    </>
  );
}
