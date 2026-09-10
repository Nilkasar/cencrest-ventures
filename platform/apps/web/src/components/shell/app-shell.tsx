"use client";

import { useState } from "react";
import { SessionProvider } from "@/lib/session-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <SessionProvider>
      <div className="min-h-dvh bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-accent-foreground"
        >
          Skip to content
        </a>
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <div className="app-content flex min-h-dvh flex-col">
          <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
          <main id="main-content" className="flex-1 px-4 py-8 sm:px-8">
            <div className="mx-auto w-full max-w-[1180px]">{children}</div>
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
