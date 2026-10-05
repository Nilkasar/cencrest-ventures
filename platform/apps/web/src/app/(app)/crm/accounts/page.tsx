import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { AccountsView } from "@/components/crm/accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Companies that converted from a lead, with their open pipeline, won revenue and history in one place."
      />
      <AccountsView />
    </>
  );
}
