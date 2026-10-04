"use client";

import { useState } from "react";
import { Building2, Clock, Handshake, Lightbulb, ShieldCheck, ShieldOff, Users } from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  RefreshOverlay,
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
  useToast,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar, ToolbarSearch } from "@/components/patterns/toolbar";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Notice } from "@/components/settings/form-controls";
import { InviteClientDialog } from "./invite-client-dialog";
import { AgencyLinkStatusBadge, AgencyRoleBadge, AvsCell, LINK_STATUS_LABEL } from "./status-badges";
import { useAsyncData, type AsyncState } from "@/lib/use-async-data";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format";
import {
  acceptAgencyClient,
  listAgencyClients,
  listIncomingAgencyLinks,
  revokeAgencyClient,
} from "@/data/agency/client";
import type { AgencyClientLink, AgencyLinkStatus, IncomingAgencyLink } from "@/data/agency/types";

/**
 * `/agency` — Epic 18's agency dashboard. Two tabs on the SAME
 * `agency_clients` table, one per side of the relationship (see
 * `routes/agency.ts`'s "two distinct read/write paths on the same table"):
 *
 *   "Clients"                — orgs THIS org manages (agency side). Invite,
 *                              see each client's real summary, revoke.
 *   "Agencies with access"   — orgs managing THIS org (client side). Accept
 *                              a pending invitation (the explicit consent
 *                              step), decline, or revoke.
 *
 * Both lists are fetched here so the tab bar can show counts and flag
 * invitations waiting on this org. Every mutation `reload()`s its own list
 * — never an optimistic local edit — so the very next read reflects the
 * server's state (the revoke DoD depends on it).
 */

const REVOCABLE: AgencyLinkStatus[] = ["active", "pending", "paused"];

export function AgencyClientsView() {
  const clients = useAsyncData(listAgencyClients, []);
  const incoming = useAsyncData(listIncomingAgencyLinks, []);

  const clientCount = clients.status === "success" ? clients.data.length : undefined;
  const awaitingUs = incoming.status === "success" ? incoming.data.filter((l) => l.status === "pending").length : 0;
  const incomingCount = incoming.status === "success" ? incoming.data.length : undefined;

  return (
    <Tabs defaultValue="clients">
      <PageHeader
        title="Agency"
        description="Client organizations you manage, and agencies with access to yours. Every link is an explicit grant the other side accepted."
        tabs={
          <TabsList variant="underline" aria-label="Agency relationships">
            <TabsTrigger value="clients" className="gap-2">
              Clients
              {clientCount !== undefined && <TabCount value={clientCount} />}
            </TabsTrigger>
            <TabsTrigger value="incoming" className="gap-2">
              Agencies with access
              {awaitingUs > 0 ? (
                <TabCount value={awaitingUs} attention label={`${awaitingUs} awaiting your response`} />
              ) : (
                incomingCount !== undefined && <TabCount value={incomingCount} />
              )}
            </TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="clients" className="mt-0">
        <ManagedClientsPanel state={clients} />
      </TabsContent>
      <TabsContent value="incoming" className="mt-0">
        <IncomingAgenciesPanel state={incoming} />
      </TabsContent>
    </Tabs>
  );
}

function TabCount({ value, attention = false, label }: { value: number; attention?: boolean; label?: string }) {
  return (
    <span
      className={
        attention
          ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-muted px-1.5 font-mono text-[11px] font-medium tabular-nums text-warning"
          : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground"
      }
    >
      <span aria-hidden={label ? true : undefined}>{value}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

type ListState<T> = AsyncState<T[]> & { isRefreshing: boolean; reload: () => void };

// ---------------------------------------------------------------------------
// Agency side — "Clients"

const CLIENT_COLUMNS: SkeletonColumn[] = [
  { header: "Client", cell: "entity" },
  { header: "Access", cell: "badge" },
  { header: "Status", cell: "badge" },
  { header: "AI Visibility", cell: "number", align: "right" },
  { header: "Open opps", cell: "number", align: "right" },
  { header: "Invited", cell: "meta" },
  { header: "", cell: "meta" },
];

const STATUS_FILTER: { value: AgencyLinkStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(["active", "pending", "paused", "revoked", "terminated"] as const).map((s) => ({ value: s, label: LINK_STATUS_LABEL[s] })),
];

function ManagedClientsPanel({ state }: { state: ListState<AgencyClientLink> }) {
  const { reload } = state;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AgencyLinkStatus | "all">("all");
  const [pendingRevoke, setPendingRevoke] = useState<AgencyClientLink | null>(null);
  const { toast } = useToast();

  async function handleRevoke(link: AgencyClientLink) {
    try {
      await revokeAgencyClient(link.id);
      toast({ title: "Access revoked", description: `${link.clientOrgName ?? "This client"}'s data is no longer reachable.`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't revoke access", description: "Try again in a moment.", variant: "danger" });
    }
  }

  const links = state.status === "success" ? state.data : null;
  const firstRun = links !== null && links.length === 0;
  const hasFilters = search.trim() !== "" || status !== "all";

  // The API returns this org's full link list (no pagination), so these
  // totals are across every link, not a page of them.
  const active = links?.filter((l) => l.status === "active") ?? [];
  const pending = links?.filter((l) => l.status === "pending").length ?? 0;
  const opportunityCounts = active.map((l) => l.summary?.openOpportunities).filter((n): n is number => typeof n === "number");
  const openOpportunities = opportunityCounts.length > 0 ? opportunityCounts.reduce((a, b) => a + b, 0) : null;

  const q = search.trim().toLowerCase();
  const visible =
    links?.filter(
      (l) =>
        (status === "all" || l.status === status) &&
        (!q || (l.clientOrgName ?? "").toLowerCase().includes(q) || (l.clientOrgSlug ?? "").toLowerCase().includes(q)),
    ) ?? [];

  function clearFilters() {
    setSearch("");
    setStatus("all");
  }

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid columns={3}>
          <StatTile
            label="Active clients"
            icon={<Building2 size={13} />}
            loading={!links}
            value={formatNumber(active.length)}
            hint="Accepted, and readable now"
          />
          <StatTile
            label="Awaiting acceptance"
            icon={<Clock size={13} />}
            loading={!links}
            value={formatNumber(pending)}
            hint="Invitations the client hasn't answered"
          />
          <StatTile
            label="Open opportunities"
            icon={<Lightbulb size={13} />}
            loading={!links}
            value={openOpportunities === null ? "—" : formatNumber(openOpportunities)}
            muted={openOpportunities === null}
            hint="Across active clients"
          />
        </StatGrid>
      )}

      {!firstRun && state.status !== "error" && (
        <Toolbar
          end={
            <>
              {links && <ResultCount count={visible.length} noun="client" />}
              <InviteClientDialog onInvited={() => reload()} />
            </>
          }
        >
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name or slug" label="Search clients" />
          <FilterSelect value={status} onValueChange={setStatus} options={STATUS_FILTER} label="Filter by status" />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={CLIENT_COLUMNS} rows={4} label="Loading clients…" />}

        {state.status === "error" && <ErrorPanel title="Clients didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<Handshake size={20} />}
            title="No client organizations yet"
            description="Invite a client by their organization slug. They have to accept before you can see or act on anything — access is never granted one-sided."
            action={<InviteClientDialog onInvited={() => reload()} />}
          />
        )}

        {links && links.length > 0 && visible.length === 0 && (
          <NoResults noun="clients" onClear={clearFilters} hint="Try a different name, slug, or status." />
        )}

        {visible.length > 0 && (
          <RefreshOverlay active={state.isRefreshing}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">AI Visibility</TableHead>
                  <TableHead className="text-right">Open opps</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <OrgCell name={link.clientOrgName} slug={link.clientOrgSlug} />
                    </TableCell>
                    <TableCell>
                      <AgencyRoleBadge role={link.role} size="sm" />
                    </TableCell>
                    <TableCell>
                      <AgencyLinkStatusBadge status={link.status} size="sm" />
                    </TableCell>
                    <TableCell className="text-right">
                      <AvsCell score={link.summary?.aiVisibilityScore ?? null} />
                    </TableCell>
                    <TableCell className={`text-right ${typography.numeric}`}>
                      {typeof link.summary?.openOpportunities === "number" ? (
                        formatNumber(link.summary.openOpportunities)
                      ) : (
                        <span className="text-subtle-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <time dateTime={link.invitedAt} title={formatDate(link.invitedAt)} className={typography.meta}>
                        {formatRelativeTime(link.invitedAt)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right">
                      {REVOCABLE.includes(link.status) && (
                        <Button variant="ghost" size="sm" onClick={() => setPendingRevoke(link)}>
                          <ShieldOff size={13} aria-hidden="true" />
                          {link.status === "pending" ? "Withdraw" : "Revoke"}
                          <span className="sr-only"> access to {link.clientOrgName ?? "this client"}</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </RefreshOverlay>
        )}
      </Reveal>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title={pendingRevoke?.status === "pending" ? "Withdraw this invitation?" : `Revoke access to ${pendingRevoke?.clientOrgName ?? "this client"}?`}
        description="This takes effect immediately — the very next request acting as this client is rejected. To work with them again you'll need to send a new invitation."
        confirmLabel={pendingRevoke?.status === "pending" ? "Withdraw invitation" : "Revoke access"}
        onConfirm={() => (pendingRevoke ? handleRevoke(pendingRevoke) : undefined)}
      />
    </PageStack>
  );
}

function OrgCell({ name, slug }: { name: string | null; slug: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar fallback={getInitials(name ?? slug ?? "?")} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">{name ?? "Deleted organization"}</p>
        <p className="truncate font-mono text-[11.5px] text-muted-foreground">{slug ?? "—"}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client side — "Agencies with access"

const INCOMING_COLUMNS: SkeletonColumn[] = [
  { header: "Agency", cell: "entity" },
  { header: "Access requested", cell: "badge" },
  { header: "Status", cell: "badge" },
  { header: "Invited", cell: "meta" },
  { header: "", cell: "meta" },
];

function IncomingAgenciesPanel({ state }: { state: ListState<IncomingAgencyLink> }) {
  const { reload } = state;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<IncomingAgencyLink | null>(null);
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
    try {
      await revokeAgencyClient(link.id);
      toast({ title: "Access removed", description: `${link.agencyOrgName ?? "That agency"} can no longer act on your organization.`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't remove access", description: "Try again in a moment.", variant: "danger" });
    }
  }

  const links = state.status === "success" ? state.data : null;
  const waiting = links?.filter((l) => l.status === "pending").length ?? 0;

  return (
    <PageStack>
      {waiting > 0 && (
        <Reveal>
          <Notice tone="warning" title={waiting === 1 ? "1 agency is waiting for your answer" : `${waiting} agencies are waiting for your answer`}>
            Nothing is shared until you accept. Accepting gives the agency the access level shown, and you can revoke it at any time.
          </Notice>
        </Reveal>
      )}

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={INCOMING_COLUMNS} rows={3} label="Loading agencies…" />}

        {state.status === "error" && <ErrorPanel title="Agencies didn't load" message={state.error.message} onRetry={reload} />}

        {links && links.length === 0 && (
          <EmptyState
            icon={<Users size={20} />}
            title="No agencies have access"
            description="When an agency invites your organization, the invitation appears here for an admin to accept or decline. Nothing is shared until you accept."
          />
        )}

        {links && links.length > 0 && (
          <RefreshOverlay active={state.isRefreshing}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agency</TableHead>
                  <TableHead>Access requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortPendingFirst(links).map((link) => {
                  const name = link.agencyOrgName ?? "this agency";
                  return (
                    <TableRow key={link.id}>
                      <TableCell>
                        <OrgCell name={link.agencyOrgName} slug={link.agencyOrgSlug} />
                      </TableCell>
                      <TableCell>
                        <AgencyRoleBadge role={link.role} size="sm" />
                      </TableCell>
                      <TableCell>
                        <AgencyLinkStatusBadge status={link.status} size="sm" />
                      </TableCell>
                      <TableCell>
                        <time dateTime={link.invitedAt} title={formatDate(link.invitedAt)} className={typography.meta}>
                          {formatRelativeTime(link.invitedAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {REVOCABLE.includes(link.status) && (
                            <Button variant="ghost" size="sm" onClick={() => setPendingRevoke(link)} disabled={busyId !== null}>
                              {link.status === "pending" ? "Decline" : "Revoke"}
                              <span className="sr-only"> {name}</span>
                            </Button>
                          )}
                          {link.status === "pending" && (
                            <Button variant="primary" size="sm" onClick={() => handleAccept(link)} loading={busyId === link.id} disabled={busyId !== null}>
                              <ShieldCheck size={13} aria-hidden="true" />
                              Accept
                              <span className="sr-only"> invitation from {name}</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </RefreshOverlay>
        )}
      </Reveal>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title={
          pendingRevoke?.status === "pending"
            ? `Decline ${pendingRevoke.agencyOrgName ?? "this agency"}'s invitation?`
            : `Remove ${pendingRevoke?.agencyOrgName ?? "this agency"}'s access?`
        }
        description="This takes effect immediately. The agency can't see or act on your organization unless they send a new invitation and you accept it."
        confirmLabel={pendingRevoke?.status === "pending" ? "Decline invitation" : "Remove access"}
        onConfirm={() => (pendingRevoke ? handleRevoke(pendingRevoke) : undefined)}
      />
    </PageStack>
  );
}

function sortPendingFirst(links: IncomingAgencyLink[]): IncomingAgencyLink[] {
  return [...links].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
}
