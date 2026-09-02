"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@bebest/ui";
import { organizations, currentOrganization } from "@/data/fixtures";

/**
 * Visual-only placeholder: switches the displayed label locally but does
 * not change any route or fetch anything — there's no per-org data to
 * scope to yet. Real org switching lands with Epic 0's backend (orgs +
 * multi-tenancy) once a session exists to persist the choice against.
 */
export function OrgSwitcher() {
  const [selected, setSelected] = useState(currentOrganization.id);
  const active = organizations.find((org) => org.id === selected) ?? currentOrganization;

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
          {active.name.slice(0, 1)}
        </span>
        <span className="truncate max-w-[140px]">{active.name}</span>
        <ChevronsUpDown size={13} className="text-subtle-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => setSelected(org.id)} className="justify-between">
            <span className="truncate">{org.name}</span>
            {org.id === selected && <Check size={14} className="text-accent shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Create organization (Epic 0)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
