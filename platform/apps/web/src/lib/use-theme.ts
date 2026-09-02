"use client";

import { useCallback, useSyncExternalStore } from "react";

type ThemePreference = "light" | "dark";
const STORAGE_KEY = "bebest-theme";
const CHANGE_EVENT = "bebest-theme-change";

function getSnapshot(): ThemePreference {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Deterministic value for the server-rendered/first-paint markup — the
 *  inline script in layout.tsx applies any real override before hydration,
 *  so this only matters for the brief window before that runs. */
function getServerSnapshot(): ThemePreference {
  return "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Reads/writes the explicit theme override via useSyncExternalStore — the
 *  theme lives in the DOM (`data-theme`) and localStorage, both external to
 *  React, so this subscribes to change events rather than mirroring it into
 *  local state (see @bebest/ui/DESIGN.md#theming). */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: ThemePreference) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable (private mode) — theme still applies for this session */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggleTheme };
}
