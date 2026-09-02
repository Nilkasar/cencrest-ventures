import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata: Metadata = { title: "Actions" };

export default function ActionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Actions"
        description="What have I done and what happened? Pending approvals, in-progress work, completed actions with outcomes, and anything rolled back."
      />
      <ComingSoon
        icon={<ListChecks size={20} />}
        eyebrow="Actions"
        title="No actions yet"
        description="Actions are born from approved recommendations, so this page fills in once Opportunities has something to act on. Every autonomy level starts at Level 1 (Recommend) — nothing publishes without a human approving it first."
        epic={13}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/opportunities">View opportunities</Link>
          </Button>
        }
      />
    </>
  );
}
