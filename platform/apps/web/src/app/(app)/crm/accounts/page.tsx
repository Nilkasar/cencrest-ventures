import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { AccountsView } from "@/components/crm/accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Accounts"
        description="Companies you sell to and serve — separate from the Brand Intelligence workspace they use once they're a customer."
      />
      <AccountsView />
    </>
  );
}
