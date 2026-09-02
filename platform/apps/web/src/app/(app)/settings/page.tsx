"use client";

import { Bell, Building2, CreditCard, SlidersHorizontal, UserPlus } from "lucide-react";
import {
  Avatar,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  getInitials,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { StubActionButton } from "@/components/patterns/stub-action-button";
import { currentUser, currentOrganization } from "@/data/fixtures";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description="Brand profile, competitors, integrations, team, notifications, billing, and autonomy — organized by what Epic each depends on."
      />
      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="brand">Brand profile</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="autonomy">Autonomy</TabsTrigger>
        </TabsList>

        <TabsContent value="brand">
          <ComingSoon
            icon={<Building2 size={20} />}
            eyebrow="Brand profile"
            title="No brand profile yet"
            description="Company name, website, competitors, primary category, and key use cases are captured during onboarding and edited here afterward."
            epic={2}
          />
        </TabsContent>

        <TabsContent value="team">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-muted-foreground">
                {currentOrganization.name} · {currentOrganization.plan} plan
              </p>
              <StubActionButton
                label="Invite team member"
                message="Team invitations depend on Epic 0's auth + RBAC backend, which is landing alongside this frontend."
                variant="secondary"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar fallback={getInitials(currentUser.name)} size="sm" />
                      <span className="font-medium">{currentUser.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{currentUser.email}</TableCell>
                  <TableCell>
                    <Badge variant="accent" size="sm">
                      {currentUser.role}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="flex items-center gap-1.5 text-[12px] text-subtle-foreground">
              <UserPlus size={13} /> You&apos;re the only member — invites are stubbed until Epic 0&apos;s auth
              backend ships.
            </p>
          </div>
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
          <ComingSoon
            icon={<CreditCard size={20} />}
            eyebrow="Billing"
            title="No billing set up yet"
            description="Plan, usage against entitlements (competitors tracked, seats, queries run), invoices, and payment method will live here."
            epic={16}
          />
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
    </>
  );
}
