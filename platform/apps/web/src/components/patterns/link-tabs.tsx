"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@bebest/ui";

export interface LinkTab {
  href: string;
  label: string;
  /** Optional count chip (server total). */
  count?: number;
  /** Match only the exact path (use for an index tab whose siblings are nested under it). */
  exact?: boolean;
}

/**
 * Page-level tabs where each tab is its own route. Visually identical to
 * `<TabsList variant="underline">` (use that for in-page Radix tabs).
 */
export function LinkTabs({ tabs, label, className }: { tabs: LinkTab[]; label: string; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={cn("border-b border-border", className)}>
      <ul className="-mb-px flex items-end gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-0.5 text-[13px] font-medium transition-colors",
                  "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-foreground after:bg-accent" : "text-muted-foreground after:bg-transparent hover:text-foreground",
                )}
              >
                {tab.label}
                {typeof tab.count === "number" && (
                  <span className="rounded-full bg-surface px-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">{tab.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
