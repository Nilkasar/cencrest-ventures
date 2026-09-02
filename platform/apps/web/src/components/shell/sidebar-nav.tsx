"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@bebest/ui";
import { navGroups, settingsItem, type NavItem } from "@/data/nav";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 h-8 px-3 rounded-md text-[13px] font-medium",
        "transition-colors duration-150",
        active
          ? "bg-ink-0/[0.08] text-ink-0"
          : "text-ink-0/55 hover:bg-ink-0/[0.05] hover:text-ink-0/90",
      )}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-verdant-400" />
      )}
      <Icon size={15} className={cn("shrink-0", active ? "text-verdant-400" : "opacity-70 group-hover:opacity-100")} />
      <span className="truncate leading-none">{item.label}</span>
    </Link>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-0/30 select-none">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-auto pt-2 border-t border-ink-0/[0.08]">
        <NavLink item={settingsItem} active={isActive(pathname, settingsItem.href)} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
