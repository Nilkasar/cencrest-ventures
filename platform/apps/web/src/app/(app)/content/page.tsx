import Link from "next/link";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata: Metadata = { title: "Content" };

export default function ContentPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Content"
        description="Active content briefs, drafts awaiting approval, published content, and performance where it's measurable."
      />
      <ComingSoon
        icon={<FileText size={20} />}
        eyebrow="Content"
        title="No content briefs yet"
        description="Once an opportunity is identified, BeBest drafts evidence-backed content — briefs, metadata, structured data — for your review here. Nothing publishes without approval."
        epic={11}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/opportunities">View opportunities</Link>
          </Button>
        }
      />
    </>
  );
}
