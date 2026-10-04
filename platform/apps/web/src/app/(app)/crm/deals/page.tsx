import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { DealsBoardView } from "@/components/crm/deals-board-view";

export const metadata: Metadata = { title: "Deals" };

export default function DealsPage() {
  return (
    <>
      <PageHeader
        title="Deals"
        description="Every engagement from first conversation to signed contract. Drag a card, or use its menu, to move it between stages."
      />
      <DealsBoardView />
    </>
  );
}
