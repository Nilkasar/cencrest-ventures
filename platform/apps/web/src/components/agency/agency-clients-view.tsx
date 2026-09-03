"use client";

import { useState } from "react";
import { Handshake, ShieldOff, Users } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
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
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { InviteClientDialog } from "./invite-client-dialog";
import { AgencyLinkStatusBadge, AgencyRoleBadge, AvsCell } from "./status-badges";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate } from "@/lib/format";
import {
  acceptAgencyClient,
  listAgencyClients,
  listIncomingAgencyLinks,
  revokeAgencyClient,
} from "@/data/agency/client";
import type { AgencyClientLink, IncomingAgencyLink } from "@/data/agency/types";

/**
 * Settings > Agency (and the `/agency` nav page) — Epic 18's agency
 * dashboard. Two tabs on the SAME `agency_clients` table, one per side of
 * the relationship (see `routes/agency.ts`'s own "two distinct read/write
 * paths on the same table, by design" header comment):
 *
 *   "My clients"            — orgs THIS org manages (agency side). Invite,
 *                              view real per-client summary, revoke.
 *   "Agencies managing us"  — orgs managing THIS org (client side). Accept
 *                              a pending invitation (the explicit consent
 *                              step the epic's DoD requires), or revoke.
 *
 * Every mutating action re-`reload()`s its own list, never mutates local
 * state optimistically — the revoke DoD test this UI exercises depends on
 * the very next read reflecting the server's fresh state, not a client-side
 * guess.
 */
export function AgencyClientsView() {
  return (
    <Tabs defaultValue="clients">
      <TabsList>
        <TabsTrigger value="clients">My clients</TabsTrigger>
        <TabsTrigger value="incoming">Agencies managing us</TabsTrigger>
      </TabsList>
      <TabsContent value="clients">
        <ManagedClientsPanel />
      </TabsContent>
      <TabsContent value="incoming">
        <IncomingAgenciesPanel />
      </TabsContent>
    </Tabs>
  );
}

function ManagedClientsPanel() {
  const { reload, ...state } = useAsyncData(listAgencyClients, []);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleRevoke(link: AgencyClientLink) {
    const confirmed = window.confirm(
      `Revoke access to ${link.clientOrgName ?? "this client"}? This takes effect immediately — the very next request "acting as" this client will be rejected.`,
    );
    if (!confirmed) return;
    setRevokingId(link.id);
    try {
      await revokeAgencyClient(link.id);
      toast({ title: "Access revoked", description: `${link.clientOrgName ?? "This client"}'s data is no longer reachable.`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't revoke access", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setRevokingId(null);
    }
  }

  if (state.status === "loading") {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const links = state.data;
  const revocable = (status: AgencyClientLink["status"]) => status === "active" || status === "pending" || status === "paused";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {links.length === 0 ? "No client organizations yet." : `${links.length} client organization${links.length === 1 ? "" : "s"}.`}
        </p>
        <InviteClientDialog onInvited={() => reload()} />
      </div>

      {links.length === 0 ? (
        <EmptyState
          icon={<Handshake size={20} />}
          eyebrow="Agency"
          title="No client organizations yet"
          description="Invite a client by their organization slug. They'll need to accept before you can view or act on their data — nothing here grants access unilaterally."
          action={<InviteClientDialog onInvited={() => reload()} />}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>AI Visibility</TableHead>
              <TableHead>Open opportunities</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((link) => (
              <TableRow key={link.id}>
                <TableCell>
                  <p className="text-[13px] font-medium text-foreground">{link.clientOrgName ?? "(deleted org)"}</p>
                  <p className="text-[12px] text-muted-foreground">{link.clientOrgSlug}</p>
                </TableCell>
                <TableCell>
                  <AgencyRoleBadge role={link.role} size="sm" />
                </TableCell>
                <TableCell>
                  <AgencyLinkStatusBadge status={link.status} size="sm" />
                </TableCell>
                <TableCell>
                  {link.summary ? <AvsCell score={link.summary.aiVisibilityScore} /> : <span className="text-subtle-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {link.summary?.openOpportunities !== null && link.summary?.openOpportunities !== undefined ? (
                    <span className="font-mono text-[12.5px]">{link.summary.openOpportunities}</span>
                  ) : (
                    <span className="text-subtle-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-[12.5px] text-muted-foreground">{formatDate(link.invitedAt)}</span>
                </TableCell>
                <TableCell className="text-right">
                  {revocable(link.status) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(link)}
                      loading={revokingId === link.id}
                      disabled={revokingId !== null}
                    >
                      <ShieldOff size={13} /> Revoke
                    </Button>
                  ) : (
                    <span className="text-[12px] text-subtle-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function IncomingAgenciesPanel() {
  const { reload, ...state } = useAsyncData(listIncomingAgencyLinks, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleAccept(link: IncomingAgencyLink) {
    setBusyId(link.id);
    try {
      await acceptAgencyClient(link.id);
      toast({ title: "Invitation accepted", description: `${link.agencyOrgName ?? "This agency"} can now manage this organization.`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't accept that invitation", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(link: IncomingAgencyLink) {
    const confirmed = window.confirm(`Remove ${link.agencyOrgName ?? "this agency"}'s access to your organization? This takes effect immediately.`);
    if (!confirmed) return;
    setBusyId(link.id);
    try {
      await revokeAgencyClient(link.id);
      toast({ title: "Access removed", description: `${link.agencyOrgName ?? "That agency"} can no longer act on your organization.`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't remove access", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  if (state.status === "loading") {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const links = state.data;
  const revocable = (status: IncomingAgencyLink["status"]) => status === "active" || status === "pending" || status === "paused";

  if (links.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Users size={18} />}
        eyebrow="Agency"
        title="No agencies manage this organization"
        description="If an agency invites you, their invitation will appear here for your organization's admin to accept."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agency</TableHead>
          <TableHead>Access offered</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Invited</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => (
          <TableRow key={link.id}>
            <TableCell>
              <p className="text-[13px] font-medium text-foreground">{link.agencyOrgName ?? "(deleted org)"}</p>
              <p className="text-[12px] text-muted-foreground">{link.agencyOrgSlug}</p>
            </TableCell>
            <TableCell>
              <AgencyRoleBadge role={link.role} size="sm" />
            </TableCell>
            <TableCell>
              <AgencyLinkStatusBadge status={link.status} size="sm" />
            </TableCell>
            <TableCell>
              <span className="text-[12.5px] text-muted-foreground">{formatDate(link.invitedAt)}</span>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                {link.status === "pending" && (
                  <Button variant="primary" size="sm" onClick={() => handleAccept(link)} loading={busyId === link.id} disabled={busyId !== null}>
                    Accept
                  </Button>
                )}
                {revocable(link.status) && (
                  <Button variant="outline" size="sm" onClick={() => handleRevoke(link)} loading={busyId === link.id} disabled={busyId !== null}>
                    <ShieldOff size={13} /> {link.status === "pending" ? "Decline" : "Revoke"}
                  </Button>
                )}
                {!revocable(link.status) && <Badge variant="neutral" size="sm">No action</Badge>}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
