"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { BrandProfilePanel } from "@/components/settings/brand-profile-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { WhiteLabelPanel } from "@/components/settings/white-label-panel";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { TeamPanel } from "@/components/settings/team-panel";

const TAB_VALUES = ["brand", "team", "notifications", "billing", "white-label", "integrations", "autonomy"] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(value: string | null): value is TabValue {
  return !!value && (TAB_VALUES as readonly string[]).includes(value);
}

function SettingsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = isTabValue(searchParams.get("tab")) ? searchParams.get("tab")! : "brand";

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="brand">Brand profile</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="white-label">White label</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="autonomy">Autonomy</TabsTrigger>
      </TabsList>

      <TabsContent value="brand">
        <BrandProfilePanel />
      </TabsContent>

      <TabsContent value="team">
        <TeamPanel />
      </TabsContent>

      <TabsContent value="notifications">
        <ComingSoon
          icon={<Bell size={20} />}
          eyebrow="Notifications"
          title="Nothing to notify you about yet"
          description="Weekly digests, competitor movement alerts, and action outcomes will have per-channel preferences here (email first, others later)."
          epic={15}
        />
      </TabsContent>

      <TabsContent value="billing">
        <BillingPanel />
      </TabsContent>

      <TabsContent value="white-label">
        <WhiteLabelPanel />
      </TabsContent>

      <TabsContent value="integrations">
        <IntegrationsPanel />
      </TabsContent>

      <TabsContent value="autonomy">
        <ComingSoon
          icon={<SlidersHorizontal size={20} />}
          eyebrow="Autonomy"
          title="Autonomy level: 1 — Recommend"
          description="Every organization starts at Level 1: the system recommends, a human decides and implements. Levels 3–4 (approve-and-execute, autonomous) require explicit opt-in once the Action Center's audit trail exists — never for billing, security, or account changes."
          epic={12}
        />
      </TabsContent>
    </Tabs>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description="Brand profile, competitors, integrations, team, notifications, billing, and autonomy — organized by what Epic each depends on."
      />
      <Suspense fallback={null}>
        <SettingsTabs />
      </Suspense>
    </>
  );
}
