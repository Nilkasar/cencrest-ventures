import { PageHeader } from "@/components/patterns/page-header";
import { CrmBasePathProvider } from "@/components/crm/crm-base-path";
import { GrowthTabs } from "@/components/platform/growth-tabs";

/**
 * Platform → Growth. The CRM screens (leads, deals, accounts) are the same
 * components the internal org uses at `/crm/*` — rendered here with the
 * CRM base path set to `/platform/growth`, so every link inside them stays
 * in the Platform view. The CRM API admits platform staff whatever org is
 * active. Snapshots is Platform-only (`/api/platform/growth/snapshots`).
 */
export default function GrowthLayout({ children }: { children: React.ReactNode }) {
  return (
    <CrmBasePathProvider base="/platform/growth">
      <PageHeader
        eyebrow="Platform"
        title="Growth"
        description="The sales pipeline — leads, deals and accounts in BeBest's CRM — and every free-snapshot request that feeds it."
        className="mb-0 border-b-0 pb-4"
      />
      <GrowthTabs />
      {children}
    </CrmBasePathProvider>
  );
}
