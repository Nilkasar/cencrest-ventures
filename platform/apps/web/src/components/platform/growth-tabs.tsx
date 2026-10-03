"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@bebest/ui";

const TABS = [
  { href: "/platform/growth/leads", label: "Leads" },
  { href: "/platform/growth/deals", label: "Deals" },
  { href: "/platform/growth/accounts", label: "Accounts" },
  { href: "/platform/growth/snapshots", label: "Snapshots" },
] as const;

/** Route-backed tabs for Platform → Growth: each tab is a real URL (deep-linkable, Back works). Styled to match `TabsList`. */
export function GrowthTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Growth sections" className="-mx-1 mb-6 overflow-x-auto border-b border-border px-1 pb-4">
      <ul className="inline-flex items-center gap-1 rounded-lg bg-surface p-1 shadow-xs">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md px-3.5 text-[13px] font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border border-border bg-surface-raised text-foreground shadow-sm"
                    : "border border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
