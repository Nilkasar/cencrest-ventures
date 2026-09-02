import type { Metadata } from "next";
import { AccountDetailView } from "@/components/crm/account-detail-view";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountDetailView accountId={id} />;
}
