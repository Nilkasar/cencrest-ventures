import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ActionsView } from "@/components/actions/actions-view";

export const metadata: Metadata = { title: "Actions" };

export default function ActionsPage() {
  return (
    <>
      <PageHeader
        title="Actions"
        description="What you've approved, what's been published, and what happened next. Nothing here publishes without an explicit approval and a separate execute step."
      />
      <ActionsView />
    </>
  );
}
