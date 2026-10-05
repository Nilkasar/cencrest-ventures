"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "bebest-sidebar";
const CHANGE_EVENT = "bebest-sidebar-change";

/** Desktop rail state lives on `<html data-sidebar>` (restored before paint
 *  by `theme-script.ts`) so `.app-content`'s offset is pure CSS — same
 *  external-store pattern as `use-theme.ts`. */
function getSnapshot(): boolean {
  return document.documentElement.getAttribute("data-sidebar") === "collapsed";
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCollapsed = useCallback((next: boolean) => {
    if (next) document.documentElement.setAttribute("data-sidebar", "collapsed");
    else document.documentElement.removeAttribute("data-sidebar");
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      /* localStorage unavailable — state still applies for this session */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed(!getSnapshot()), [setCollapsed]);

  return { collapsed, setCollapsed, toggleCollapsed };
}

/** Group open/closed state, persisted per group label. */
const GROUPS_KEY = "bebest-sidebar-groups";

export function readClosedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function writeClosedGroups(labels: string[]) {
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(labels));
  } catch {
    /* ignore */
  }
}
