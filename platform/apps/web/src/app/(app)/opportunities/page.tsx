import Link from "next/link";
import { Target } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata: Metadata = { title: "Opportunities" };

export default function OpportunitiesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Opportunities"
        description="What should I do next? A unified SEO + GEO opportunity list, filterable by effort, impact, and type, each with evidence attached."
      />
      <ComingSoon
        icon={<Target size={20} />}
        eyebrow="Opportunities"
        title="We're still analyzing your brand"
        description="Opportunities appear once we've compared search demand against your AI visibility gaps — the highest-ROI moves are where both line up. Add more competitors in the meantime to help us find more of them."
        epic={9}
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/competitors">Add a competitor</Link>
          </Button>
        }
      />
    </>
  );
}
