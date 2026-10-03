"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { orgNavGroups, platformNavGroups, settingsItem, type NavGroup, type NavItem } from "@/data/nav";
import { useSession } from "@/lib/session-context";

export interface WorkspaceNav {
  workspace: "platform" | "org";
  groups: NavGroup[];
  /** Pinned below the groups (Settings in the Organization view). */
  footer: NavItem | null;
}

/** The sidebar/breadcrumb/jump-to nav for whichever view the user is in:
 *  Platform under `/platform`, otherwise the active org's Organization view
 *  (CRM only for `internal`, Agency only for `agency` orgs). */
export function useWorkspaceNav(): WorkspaceNav {
  const pathname = usePathname();
  const kind = useSession().org?.kind;
  const inPlatform = pathname === "/platform" || pathname.startsWith("/platform/");

  return useMemo(
    () =>
      inPlatform
        ? { workspace: "platform", groups: platformNavGroups, footer: null }
        : { workspace: "org", groups: orgNavGroups(kind), footer: settingsItem },
    [inPlatform, kind],
  );
}
