"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Network, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useToast,
} from "@bebest/ui";
import { ApiError } from "@/lib/api-client";
import { useSession, type OrgKind, type WorkspaceView } from "@/lib/session-context";

type OrgView = Extract<WorkspaceView, { type: "org" }>;
type AgencyView = Extract<WorkspaceView, { type: "agency" }>;

/** Routes only some org kinds may sit on — leaving them after a switch
 *  avoids landing on a page the new org's nav doesn't offer. */
function allowedFor(pathname: string, kind: OrgKind): boolean {
  if (pathname.startsWith("/platform")) return false;
  if (pathname === "/agency" || pathname.startsWith("/agency/")) return kind === "agency";
  if (pathname === "/crm" || pathname.startsWith("/crm/")) return kind === "internal";
  return true;
}

function Monogram({ name, tone, size = "md" }: { name: string; tone: "accent" | "platform" | "agency"; size?: "md" | "sm" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md font-semibold",
        size === "md" ? "size-7 text-[12px]" : "size-5 text-[10px]",
        tone === "accent" && "bg-accent text-accent-foreground",
        tone === "platform" && "bg-foreground text-background",
        tone === "agency" && "border border-accent/40 bg-accent-muted text-accent",
      )}
    >
      {tone === "platform" ? (
        <ShieldCheck size={size === "md" ? 14 : 11} />
      ) : tone === "agency" ? (
        <Network size={size === "md" ? 14 : 11} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/**
 * Workspace switcher at the top of the sidebar (Epic 22). Lists only the
 * views `/auth/me` says this user may enter — Platform (staff), Agency
 * portfolio (agency members), their own organizations, and the clients
 * their agency manages. Every org choice, including going back home,
 * re-mints the access token via `POST /auth/select-org` (`switchOrg`).
 */
export function ViewSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { org, user, loading, views, memberships, switchOrg } = useSession();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (loading && !user) {
    return collapsed ? (
      <Skeleton className="mx-auto size-10 rounded-lg" />
    ) : (
      <Skeleton className="h-12 w-full rounded-lg" />
    );
  }
  if (!user) return null;

  const platformView = views.find((v): v is Extract<WorkspaceView, { type: "platform" }> => v.type === "platform");
  const agencyViews = views.filter((v): v is AgencyView => v.type === "agency");
  const ownOrgs = views.filter((v): v is OrgView => v.type === "org" && v.source === "membership");
  const clients = views.filter((v): v is OrgView => v.type === "org" && v.source === "agency-client");

  const inPlatform = pathname === "/platform" || pathname.startsWith("/platform/");
  const inAgency = (pathname === "/agency" || pathname.startsWith("/agency/")) && org?.kind === "agency";
  const activeId = inPlatform ? "platform" : inAgency ? `agency:${org?.slug}` : org ? `org:${org.slug}` : null;

  const current = inPlatform
    ? { name: "BeBest Platform", caption: "Platform", tone: "platform" as const }
    : inAgency
      ? { name: org?.name ?? "Agency", caption: "Agency portfolio", tone: "agency" as const }
      : {
          name: org?.name ?? "No organization",
          caption: org?.viaAgency ? "Client" : "Organization",
          tone: "accent" as const,
        };

  async function enter(view: WorkspaceView) {
    if (pendingId) return;
    if (view.type === "platform") {
      setOpen(false);
      router.push(view.href);
      onNavigate?.();
      return;
    }
    const slug = view.type === "agency" ? view.organization.slug : view.slug;
    const targetKind: OrgKind = view.type === "agency" ? "agency" : view.kind;
    const destination = view.type === "agency" ? "/agency" : allowedFor(pathname, targetKind) ? null : "/overview";

    // Already acting as this org: only the route changes.
    if (org?.slug === slug) {
      setOpen(false);
      if (destination) {
        router.push(destination);
        onNavigate?.();
      }
      return;
    }

    setPendingId(view.id);
    try {
      const selected = await switchOrg(slug);
      if (destination) router.push(destination);
      onNavigate?.();
      toast({
        title: view.type === "agency" ? `${selected.name} portfolio` : `Now working in ${selected.name}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Couldn't switch workspace",
        description:
          err instanceof ApiError && (err.status === 403 || err.status === 404)
            ? "You no longer have access to that organization."
            : "That workspace isn't reachable right now. Try again in a moment.",
        variant: "danger",
      });
    } finally {
      setPendingId(null);
      setOpen(false);
    }
  }

  function row(view: WorkspaceView, name: string, tone: "accent" | "platform" | "agency", caption?: string) {
    const active = activeId === view.id;
    const pending = pendingId === view.id;
    return (
      <DropdownMenuItem
        key={view.id}
        onSelect={(event) => {
          event.preventDefault(); // keep the menu open while the switch is in flight
          void enter(view);
        }}
        disabled={pendingId !== null && !pending}
        aria-current={active ? "true" : undefined}
        className="min-h-10 gap-2.5 py-1.5"
      >
        <Monogram name={name} tone={tone} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] text-foreground">{name}</span>
          {caption && <span className="truncate text-[11px] text-subtle-foreground">{caption}</span>}
        </span>
        {pending ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-subtle-foreground" aria-label="Switching" />
        ) : (
          active && <Check size={14} className="shrink-0 text-accent" aria-hidden />
        )}
      </DropdownMenuItem>
    );
  }

  const agencyName = (id?: string) => memberships.find((m) => m.id === id)?.name;
  const clientsByAgency = new Map<string, OrgView[]>();
  for (const c of clients) {
    const key = c.agencyOrganizationId ?? "";
    clientsByAgency.set(key, [...(clientsByAgency.get(key) ?? []), c]);
  }

  const triggerLabel = `Switch workspace. Current: ${current.caption}, ${current.name}`;

  const trigger = (
    <DropdownMenuTrigger
      aria-label={triggerLabel}
      className={cn(
        "group flex items-center rounded-lg text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        collapsed
          ? "mx-auto size-10 justify-center hover:bg-foreground/[0.06] data-[state=open]:bg-foreground/[0.06]"
          : "h-12 w-full gap-2.5 border border-border bg-surface-raised px-2 shadow-xs hover:border-border-strong data-[state=open]:border-border-strong",
      )}
    >
      <Monogram name={current.name} tone={current.tone} />
      {!collapsed && (
        <>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium text-foreground">{current.name}</span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-subtle-foreground">
              {current.caption}
            </span>
          </span>
          <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-subtle-foreground" />
        </>
      )}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open={open} onOpenChange={(next) => !pendingId && setOpen(next)}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {current.name}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        sideOffset={collapsed ? 12 : 6}
        className="max-h-[min(70vh,520px)] w-[272px] overflow-y-auto"
      >
        {platformView && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Platform</DropdownMenuLabel>
            {row(platformView, "BeBest Platform", "platform", "All organizations · staff")}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}

        {agencyViews.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Agency portfolio</DropdownMenuLabel>
            {agencyViews.map((v) =>
              row(v, v.organization.name, "agency", "Client portfolio"),
            )}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}

        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {ownOrgs.length === 0 ? (
            <DropdownMenuItem disabled>You aren&apos;t a member of any organization</DropdownMenuItem>
          ) : (
            ownOrgs.map((v) =>
              row(v, v.name, "accent", v.kind === "agency" ? "Agency" : v.kind === "internal" ? "BeBest internal" : undefined),
            )
          )}
        </DropdownMenuGroup>

        {[...clientsByAgency.entries()].map(([agencyId, list]) => (
          <DropdownMenuGroup key={agencyId}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-baseline justify-between gap-2">
              <span>Clients</span>
              {agencyName(agencyId) && (
                <span className="truncate normal-case tracking-normal">via {agencyName(agencyId)}</span>
              )}
            </DropdownMenuLabel>
            {list.map((v) => row(v, v.name, "accent"))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
