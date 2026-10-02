"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Search, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@bebest/ui";
import { navGroups, settingsItem, type NavItem } from "@/data/nav";
import { readClosedGroups, writeClosedGroups } from "@/lib/use-sidebar";

const EASE = [0.16, 1, 0.3, 1] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  highlighted?: boolean;
  /** Distinct per sidebar instance so the desktop rail and the mobile
   *  drawer don't animate one shared active pill between them. */
  pillId: string;
  onNavigate?: () => void;
}

function NavLink({ item, active, collapsed, highlighted, pillId, onNavigate }: NavLinkProps) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-9 items-center rounded-lg text-[13.5px] font-medium outline-none",
        "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "mx-auto w-10 justify-center" : "gap-3 px-3",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        !active && (highlighted ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.045]"),
      )}
    >
      {active && (
        <motion.span
          layoutId={pillId}
          aria-hidden
          className="absolute inset-0 rounded-lg border border-border bg-surface-raised shadow-xs"
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
        />
      )}
      {active && !collapsed && (
        <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <Icon
        size={16}
        className={cn(
          "relative shrink-0 transition-colors",
          active ? "text-accent" : "text-subtle-foreground group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

export const SidebarSearch = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }
>(function SidebarSearch({ value, onChange, onKeyDown }, ref) {
  return (
    <div className="relative px-3">
      <Search
        size={14}
        className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-subtle-foreground"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Jump to…"
        aria-label="Jump to page"
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-surface-raised pl-9 pr-12 text-[13px] text-foreground shadow-xs",
          "placeholder:text-subtle-foreground outline-none transition-colors",
          "hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-ring/25",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X size={13} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1.5 font-mono text-[10.5px] leading-[18px] text-subtle-foreground">
          ⌘K
        </kbd>
      )}
    </div>
  );
});

interface SidebarNavProps {
  collapsed: boolean;
  query: string;
  pillId: string;
  highlightIndex: number;
  onNavigate?: () => void;
}

/** Items matching the jump-to query, in nav order. */
export function filterNav(query: string): NavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [...navGroups.flatMap((g) => g.items.map((item) => ({ item, group: g.label }))), { item: settingsItem, group: "" }]
    .filter(({ item, group }) => item.label.toLowerCase().includes(q) || group.toLowerCase().includes(q))
    .map(({ item }) => item);
}

export function useJumpTo(query: string, setQuery: (v: string) => void, onNavigate?: () => void) {
  const router = useRouter();
  const results = useMemo(() => filterNav(query), [query]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlightIndex(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      e.currentTarget.blur();
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[highlightIndex]) {
      e.preventDefault();
      router.push(results[highlightIndex].href);
      setQuery("");
      e.currentTarget.blur();
      onNavigate?.();
    }
  }

  return { highlightIndex, onKeyDown };
}

export function SidebarNav({ collapsed, query, pillId, highlightIndex, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    // Hydrate persisted group state after mount (localStorage is client-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosed(readClosedGroups());
  }, []);

  function toggleGroup(label: string) {
    setClosed((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      writeClosedGroups(next);
      return next;
    });
  }

  const results = filterNav(query);
  const searching = !collapsed && query.trim().length > 0;

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-width:thin]">
        {searching ? (
          results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-subtle-foreground">No pages match “{query.trim()}”</p>
          ) : (
            <div className="flex flex-col gap-0.5" role="listbox" aria-label="Matching pages">
              {results.map((item, i) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  collapsed={false}
                  highlighted={i === highlightIndex}
                  pillId={pillId}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {navGroups.map((group, gi) => {
              const isClosed = !collapsed && closed.includes(group.label);
              // A closed group still shows its active page, so "where am I" never hides.
              const visible = isClosed ? group.items.filter((item) => isActive(pathname, item.href)) : group.items;
              return (
                <div key={group.label}>
                  {collapsed ? (
                    gi > 0 && <div className="mx-auto mb-3 h-px w-6 bg-border" aria-hidden />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      aria-expanded={!isClosed}
                      className="group/heading mb-1 flex w-full items-center justify-between rounded-md px-3 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {group.label}
                      <ChevronDown
                        size={12}
                        aria-hidden
                        className={cn(
                          "opacity-0 transition-[transform,opacity] duration-200 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
                          isClosed && "-rotate-90 opacity-100",
                        )}
                      />
                    </button>
                  )}
                  <AnimatePresence initial={false}>
                    <motion.div
                      key={isClosed ? "closed" : "open"}
                      className="flex flex-col gap-0.5"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      transition={{ duration: 0.22, ease: EASE }}
                    >
                      {visible.map((item) => (
                        <NavLink
                          key={item.href}
                          item={item}
                          active={isActive(pathname, item.href)}
                          collapsed={collapsed}
                          pillId={pillId}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-3">
        <NavLink
          item={settingsItem}
          active={isActive(pathname, settingsItem.href)}
          collapsed={collapsed}
          pillId={pillId}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}
