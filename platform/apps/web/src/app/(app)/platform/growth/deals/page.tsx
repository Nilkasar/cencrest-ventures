import type { Metadata } from "next";
import { DealsBoardView } from "@/components/crm/deals-board-view";

export const metadata: Metadata = { title: "Deals · Growth" };

export default function GrowthDealsPage() {
  return <DealsBoardView />;
}
