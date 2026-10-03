"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@bebest/ui";
import { useSidebarCollapsed } from "@/lib/use-sidebar";
import { SidebarNav, SidebarSearch, useJumpTo } from "./sidebar-nav";

const SIDEBAR_WIDTH = 240;
const EASE = [0.16, 1, 0.3, 1] as const;

/** Window event that opens the sidebar's "Jump to…" search (topbar button). */
export const JUMP_EVENT = "bebest:jump-to";

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function Wordmark() {
  return (
    <Link
      href="/overview"
      className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="" className="size-7 shrink-0 object-contain" />
      <span className="font-display text-[19px] font-semibold tracking-[-0.02em] text-foreground">BeBest</span>
    </Link>
  );
}

function IconButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <kbd className="rounded bg-ink-0/10 px-1 font-mono text-[10.5px]">{shortcut}</kbd>}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarBody({
  collapsed,
  pillId,
  onClose,
  onToggleCollapsed,
  searchRef,
}: {
  collapsed: boolean;
  pillId: string;
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const { highlightIndex, onKeyDown } = useJumpTo(query, setQuery, onClose);

  return (
    <div className="flex h-full flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-[var(--sidebar-border)]",
          collapsed ? "justify-center px-3" : "justify-between gap-2 pl-5 pr-3",
        )}
      >
        {collapsed ? (
          // Rail: the mark, swapped for the expand control on hover/focus.
          <div className="group/rail relative flex size-8 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.png"
              alt=""
              className="size-7 object-contain transition-opacity group-focus-within/rail:opacity-0 group-hover/rail:opacity-0"
            />
            {onToggleCollapsed && (
              <div className="absolute inset-0 opacity-0 transition-opacity group-focus-within/rail:opacity-100 group-hover/rail:opacity-100">
                <IconButton label="Expand sidebar" shortcut="[" onClick={onToggleCollapsed}>
                  <PanelLeftOpen size={17} />
                </IconButton>
              </div>
            )}
          </div>
        ) : (
          <>
            <Wordmark />
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation"
                className="flex size-8 items-center justify-center rounded-md text-subtle-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={16} />
              </button>
            ) : (
              onToggleCollapsed && (
                <IconButton label="Collapse sidebar" shortcut="[" onClick={onToggleCollapsed}>
                  <PanelLeftClose size={17} />
                </IconButton>
              )
            )}
          </>
        )}
      </div>

      <div className="shrink-0 pt-3 pb-1">
        {collapsed ? (
          <div className="flex justify-center px-3">
            <IconButton
              label="Jump to…"
              shortcut="⌘K"
              onClick={() => {
                onToggleCollapsed?.();
                requestAnimationFrame(() => searchRef?.current?.focus());
              }}
            >
              <Search size={16} />
            </IconButton>
          </div>
        ) : (
          <SidebarSearch ref={searchRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} />
        )}
      </div>

      <SidebarNav
        collapsed={collapsed}
        query={query}
        pillId={pillId}
        highlightIndex={highlightIndex}
        onNavigate={onClose}
      />
    </div>
  );
}

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { collapsed, setCollapsed, toggleCollapsed } = useSidebarCollapsed();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileOpen, onClose]);

  // Desktop shortcuts: ⌘K / Ctrl+K jumps to a page, "[" toggles the rail.
  // The topbar's search button fires JUMP_EVENT for the same effect.
  useEffect(() => {
    function focusJump() {
      setCollapsed(false);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    function handleKey(event: KeyboardEvent) {
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusJump();
      } else if (event.key === "[" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener(JUMP_EVENT, focusJump);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(JUMP_EVENT, focusJump);
    };
  }, [setCollapsed, toggleCollapsed]);

  return (
    <MotionConfig reducedMotion="user">
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
              className="fixed inset-y-0 left-0 z-50 shadow-xl lg:hidden"
              style={{ width: SIDEBAR_WIDTH }}
              initial={{ x: -SIDEBAR_WIDTH }}
              animate={{ x: 0 }}
              exit={{ x: -SIDEBAR_WIDTH }}
              transition={{ type: "tween", duration: 0.22, ease: EASE }}
            >
              <SidebarBody collapsed={false} pillId="nav-pill-mobile" onClose={onClose} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <aside data-print-hide className="app-sidebar fixed inset-y-0 left-0 z-30 hidden overflow-hidden lg:block">
        <SidebarBody
          collapsed={collapsed}
          pillId="nav-pill-desktop"
          onToggleCollapsed={toggleCollapsed}
          searchRef={searchRef}
        />
      </aside>
    </MotionConfig>
  );
}
