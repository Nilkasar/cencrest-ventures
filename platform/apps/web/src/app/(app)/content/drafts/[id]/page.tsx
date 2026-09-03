import type { Metadata } from "next";
import { DraftApprovalView } from "@/components/content/draft-approval-view";

export const metadata: Metadata = { title: "Review draft" };

export default async function ContentDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DraftApprovalView draftId={id} />;
}
