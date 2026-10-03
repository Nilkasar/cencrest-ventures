"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, Search } from "lucide-react";
import { Button, cn } from "@bebest/ui";
import { navGroups, platformNavGroups, settingsItem, type NavItem } from "@/data/nav";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { JUMP_EVENT } from "./sidebar";

interface Crumb {
  group?: string;
  item: NavItem;
  /** True when the path is deeper than the nav item itself (a detail page). */
  nested: boolean;
  /** Label for the deeper page: a named sub-page ("Leads") or "Details" for an id. */
  nestedLabel: string;
}

function resolveCrumb(pathname: string): Crumb | null {
  const all = [
    ...[...navGroups, ...platformNavGroups].flatMap((g) =>
      g.items.filter((item) => !item.comingSoon).map((item) => ({ group: g.label as string | undefined, item })),
    ),
    { group: undefined, item: settingsItem },
  ];
  // Longest matching href wins, so /crm/leads beats a hypothetical /crm.
  const match = all
    .filter(({ item }) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
  if (!match) return null;
  const last = pathname.slice(match.item.href.length).split("/").filter(Boolean).pop() ?? "";
  // An id-like segment (uuid, cuid) is a detail page; a word is a named sub-page.
  const isId = /\d/.test(last) && last.length >= 16;
  const nestedLabel = !last || isId ? "Details" : last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
  return { ...match, nested: pathname !== match.item.href, nestedLabel };
}

function Breadcrumb() {
  const pathname = usePathname();
  const crumb = resolveCrumb(pathname);
  if (!crumb) return null;
  const Icon = crumb.item.icon;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
      {crumb.group && (
        <>
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.14em] text-subtle-foreground sm:inline">
            {crumb.group}
          </span>
          <ChevronRight size={13} className="hidden shrink-0 text-subtle-foreground/70 sm:block" aria-hidden />
        </>
      )}
      {crumb.nested ? (
        <>
          <Link
            href={crumb.item.href}
            className="flex min-w-0 items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon size={15} className="shrink-0" />
            <span className="truncate">{crumb.item.label}</span>
          </Link>
          <ChevronRight size={13} className="shrink-0 text-subtle-foreground/70" aria-hidden />
          <span aria-current="page" className="truncate font-medium text-foreground">
            {crumb.nestedLabel}
          </span>
        </>
      ) : (
        <span aria-current="page" className="flex min-w-0 items-center gap-2 font-medium text-foreground">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
            <Icon size={14} />
          </span>
          <span className="truncate">{crumb.item.label}</span>
        </span>
      )}
    </nav>
  );
}

function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(JUMP_EVENT))}
      className={cn(
        "hidden h-9 w-full max-w-[300px] items-center gap-2.5 rounded-lg border border-border bg-surface-raised pl-3 pr-1.5 lg:flex",
        "text-[13px] text-subtle-foreground shadow-xs outline-none transition-colors",
        "hover:border-border-strong hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Search size={14} aria-hidden />
      <span className="flex-1 text-left">Search pages…</span>
      <kbd className="rounded border border-border bg-surface px-1.5 font-mono text-[10.5px] leading-[18px]">⌘K</kbd>
    </button>
  );
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-print-hide
      className={cn(
        "sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md backdrop-saturate-150 transition-shadow duration-200 sm:px-6",
        scrolled ? "border-border shadow-sm" : "border-border/70",
      )}
    >
      <Button variant="ghost" size="icon" className="-ml-1 lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu size={18} />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-6">
        <Breadcrumb />
      </div>

      <SearchTrigger />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-0.5">
          <NotificationBell />
          <ThemeToggle />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
