import type { Metadata } from "next";
import { AccountsView } from "@/components/crm/accounts-view";

export const metadata: Metadata = { title: "Accounts · Growth" };

export default function GrowthAccountsPage() {
  return <AccountsView />;
}
