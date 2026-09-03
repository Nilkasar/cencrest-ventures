"use client";

import { Menu } from "lucide-react";
import { Button } from "@bebest/ui";
import { NotificationBell } from "./notification-bell";
import { OrgSwitcher } from "./org-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  return (
    <header data-print-hide className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/95 backdrop-blur-none px-4 sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu size={18} />
      </Button>
      <OrgSwitcher />
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
