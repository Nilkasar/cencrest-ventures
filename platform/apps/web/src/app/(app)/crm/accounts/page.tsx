import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Accounts"
        description="Companies you sell to and serve — separate from the Brand Intelligence workspace they use once they're a customer."
      />
      <ComingSoon
        icon={<Building2 size={20} />}
        eyebrow="Accounts"
        title="No accounts yet"
        description="An account is created once a lead is qualified, or directly for agency/enterprise relationships that manage multiple brands. Epic 1 builds accounts, contacts, and the link between an account and its BeBest workspace."
        epic={1}
        action={
          <StubActionButton
            label="Add an account"
            message="Accounts ship with Epic 1 (CRM)."
            variant="primary"
          />
        }
      />
    </>
  );
}
