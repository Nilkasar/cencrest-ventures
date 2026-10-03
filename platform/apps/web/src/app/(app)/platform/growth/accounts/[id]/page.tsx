import type { Metadata } from "next";
import { AccountDetailView } from "@/components/crm/account-detail-view";

export const metadata: Metadata = { title: "Account · Growth" };

export default async function GrowthAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountDetailView accountId={id} />;
}
