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
  Skeleton,
  useToast,
  cn,
} from "@bebest/ui";
import { listAgencyClients, switchToOrg } from "@/data/agency/client";
import type { AgencyClientLink } from "@/data/agency/types";
import { setCurrentOrgSlug, setOrgScopedAccessToken } from "@/lib/auth-state";
import { useSession } from "@/lib/session-context";

export function OrgSwitcher() {
  const { org, loading } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [clients, setClients] = useState<AgencyClientLink[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const { toast } = useToast();

  // Sync from session when org loads
  useEffect(() => {
    if (org && !selectedId) {
      setSelectedId(org.id);
      setSelectedName(org.name);
    }
  }, [org, selectedId]);

  useEffect(() => {
    if (!org) return;
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
  }, [org]);

  function handleSelectHome() {
    if (!org) return;
    setSelectedId(org.id);
    setSelectedName(org.name);
  }

  async function handleSelectClient(link: AgencyClientLink) {
    if (!link.clientOrgSlug || switchingId) return;
    setSwitchingId(link.id);
    try {
      const selection = await switchToOrg(link.clientOrgSlug);
      setOrgScopedAccessToken(selection.accessToken);
      setCurrentOrgSlug(link.clientOrgSlug);
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

  if (loading) {
    return <Skeleton className="h-8 w-36 rounded-md" />;
  }

  const displayName = selectedName ?? org?.name ?? "Organization";
  const displayId = selectedId ?? org?.id ?? "";

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
          {displayName.slice(0, 1)}
        </span>
        <span className="truncate max-w-[140px]">{displayName}</span>
        <ChevronsUpDown size={13} className="text-subtle-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organization</DropdownMenuLabel>
        <DropdownMenuItem onSelect={handleSelectHome} className="justify-between">
          <span className="truncate">{org?.name ?? displayName}</span>
          {displayId === (org?.id ?? "") && <Check size={14} className="text-accent shrink-0" />}
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
              displayId === link.clientOrgId && <Check size={14} className="text-accent shrink-0" />
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
