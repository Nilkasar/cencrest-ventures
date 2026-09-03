"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
  cn,
} from "@bebest/ui";
import { currentOrganization } from "@/data/fixtures";
import { listAgencyClients, switchToOrg } from "@/data/agency/client";
import type { AgencyClientLink } from "@/data/agency/types";
import { setOrgScopedAccessToken } from "@/lib/auth-state";

/**
 * Epic 18: the client switcher, built by extending this component in place
 * (not a parallel switcher) — per the epic's explicit instruction. The home
 * organization stays fixture-backed (`currentOrganization`; there's still
 * no wired "which orgs am I a direct member of" session in this app — see
 * `lib/api-client.ts`'s doc comment, same gap every other epic's real-API
 * wiring already carries). What's real now: the "Client organizations"
 * section below it is fetched live from `GET /api/agency/clients` (this
 * org's `active` agency_clients links) instead of the old two-entry
 * fixture list, and selecting one calls the real `POST /auth/select-org`
 * "acting as" flow (`data/agency/client.ts`'s `switchToOrg`). The Epic 0
 * session-wiring fix closed the gap this component used to flag in its own
 * doc comment: the org-scoped access token `switchToOrg` returns is now
 * stored via `setOrgScopedAccessToken` before this function returns, so
 * every subsequent `apiClient` call is already scoped to the client org by
 * the time the toast fires.
 */
export function OrgSwitcher() {
  const [selectedId, setSelectedId] = useState<string>(currentOrganization.id);
  const [selectedName, setSelectedName] = useState<string>(currentOrganization.name);
  const [clients, setClients] = useState<AgencyClientLink[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    listAgencyClients()
      .then((links) => {
        if (!cancelled) setClients(links.filter((link) => link.status === "active"));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelectHome() {
    setSelectedId(currentOrganization.id);
    setSelectedName(currentOrganization.name);
  }

  async function handleSelectClient(link: AgencyClientLink) {
    if (!link.clientOrgSlug || switchingId) return;
    setSwitchingId(link.id);
    try {
      const selection = await switchToOrg(link.clientOrgSlug);
      setOrgScopedAccessToken(selection.accessToken);
      setSelectedId(link.clientOrgId);
      setSelectedName(selection.organization.name);
      toast({ title: `Now acting as ${selection.organization.name}`, variant: "success" });
    } catch (err) {
      toast({
        title: "Couldn't switch",
        description: err instanceof Error ? err.message : "That client organization isn't reachable right now.",
        variant: "danger",
      });
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 h-8 pl-2 pr-2.5 rounded-md text-[13px] font-medium text-foreground",
          "hover:bg-surface transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex size-5 items-center justify-center rounded-[5px] bg-accent-muted text-accent text-[10px] font-semibold shrink-0">
          {selectedName.slice(0, 1)}
        </span>
        <span className="truncate max-w-[140px]">{selectedName}</span>
        <ChevronsUpDown size={13} className="text-subtle-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organization</DropdownMenuLabel>
        <DropdownMenuItem onSelect={handleSelectHome} className="justify-between">
          <span className="truncate">{currentOrganization.name}</span>
          {selectedId === currentOrganization.id && <Check size={14} className="text-accent shrink-0" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Client organizations</DropdownMenuLabel>
        {clients === null && !loadError && (
          <DropdownMenuItem disabled className="justify-between">
            <span>Loading clients…</span>
            <Loader2 size={13} className="animate-spin text-subtle-foreground" />
          </DropdownMenuItem>
        )}
        {loadError && <DropdownMenuItem disabled>Couldn&apos;t load client organizations</DropdownMenuItem>}
        {clients !== null && clients.length === 0 && !loadError && (
          <DropdownMenuItem disabled>No active clients — invite one from Agency</DropdownMenuItem>
        )}
        {clients?.map((link) => (
          <DropdownMenuItem
            key={link.id}
            onSelect={() => handleSelectClient(link)}
            disabled={switchingId !== null}
            className="justify-between"
          >
            <span className="truncate">{link.clientOrgName ?? link.clientOrgSlug}</span>
            {switchingId === link.id ? (
              <Loader2 size={13} className="animate-spin text-subtle-foreground shrink-0" />
            ) : (
              selectedId === link.clientOrgId && <Check size={14} className="text-accent shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/agency">Manage client organizations</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
