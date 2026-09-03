"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@bebest/ui";
import { SidebarNav } from "./sidebar-nav";

const SIDEBAR_WIDTH = 264;

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[19px] font-semibold text-ink-0 tracking-[-0.02em]">BeBest</span>
      <span className="size-1.5 rounded-full bg-verdant-400" aria-hidden="true" />
    </div>
  );
}

function SidebarBody({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-ink-950">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-0/[0.08] shrink-0">
        <Wordmark />
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="lg:hidden flex items-center justify-center size-7 rounded-md text-ink-0/40 hover:text-ink-0/80 hover:bg-ink-0/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <SidebarNav onNavigate={onClose} />
      <div className="shrink-0 px-5 py-3 border-t border-ink-0/[0.08] text-[11px] text-ink-0/35 font-mono">
        rebuild/platform · epic 0
      </div>
    </div>
  );
}

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileOpen, onClose]);

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-overlay lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-50 lg:hidden shadow-xl"
              style={{ width: SIDEBAR_WIDTH }}
              initial={{ x: -SIDEBAR_WIDTH }}
              animate={{ x: 0 }}
              exit={{ x: -SIDEBAR_WIDTH }}
              transition={{ type: "tween", duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <SidebarBody onClose={onClose} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <aside
        data-print-hide
        className={cn("hidden lg:block fixed inset-y-0 left-0 z-30")}
        style={{ width: SIDEBAR_WIDTH }}
      >
        <SidebarBody />
      </aside>
    </>
  );
}
