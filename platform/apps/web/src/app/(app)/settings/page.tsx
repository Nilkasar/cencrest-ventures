"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionSkeleton } from "@/components/patterns/states";
import { BrandProfilePanel } from "@/components/settings/brand-profile-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { WhiteLabelPanel } from "@/components/settings/white-label-panel";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { AutonomyPanel } from "@/components/settings/autonomy-panel";

/** Tab order: who you are → who's here → what you pay → what's connected →
 *  how you present → how you hear → how the agents act. `?tab=` deep links
 *  (e.g. `/settings?tab=billing` from the white-label upsell) keep working. */
const TABS = [
  { value: "brand", label: "Brand profile" },
  { value: "team", label: "Team" },
  { value: "billing", label: "Billing" },
  { value: "integrations", label: "Integrations" },
  { value: "white-label", label: "White label" },
  { value: "notifications", label: "Notifications" },
  { value: "autonomy", label: "Autonomy" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function isTabValue(value: string | null): value is TabValue {
  return !!value && TABS.some((tab) => tab.value === value);
}

const TITLE = "Settings";
const DESCRIPTION = "Your brand profile, team, plan, and how BeBest works for your organization.";

function SettingsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const activeTab: TabValue = isTabValue(requested) ? requested : "brand";

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        tabs={
          <TabsList variant="underline" aria-label="Settings sections">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <TabsContent value="brand" className="mt-0">
        <BrandProfilePanel />
      </TabsContent>
      <TabsContent value="team" className="mt-0">
        <TeamPanel />
      </TabsContent>
      <TabsContent value="billing" className="mt-0">
        <BillingPanel />
      </TabsContent>
      <TabsContent value="integrations" className="mt-0">
        <IntegrationsPanel />
      </TabsContent>
      <TabsContent value="white-label" className="mt-0">
        <WhiteLabelPanel />
      </TabsContent>
      <TabsContent value="notifications" className="mt-0">
        <NotificationsPanel />
      </TabsContent>
      <TabsContent value="autonomy" className="mt-0">
        <AutonomyPanel />
      </TabsContent>
    </Tabs>
  );
}

/** Shown while `useSearchParams` resolves: the real title (so the page
 *  never renders without its `<h1>`) over the brand tab's shape. */
function SettingsFallback() {
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading settings…</span>
        <SectionSkeleton lines={4} titleWidth="w-36" />
        <SectionSkeleton lines={3} titleWidth="w-28" />
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsTabs />
    </Suspense>
  );
}
