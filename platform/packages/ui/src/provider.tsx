"use client";

import * as React from "react";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "./components/tooltip";
import { ToastProvider } from "./components/toast";

/**
 * Single mount point for every cross-cutting UI concern: tooltip delay
 * group, the toast host, and — most importantly — the reduced-motion
 * contract. `<MotionConfig reducedMotion="user">` makes every Framer
 * Motion animation in the tree collapse to instant whenever the OS
 * `prefers-reduced-motion` setting is on, without every component having
 * to check for it individually. Plain CSS transitions/animations are
 * covered separately by the global media query in tokens.css.
 *
 * Mount once, at the app root:
 *   <UIProvider>{children}</UIProvider>
 */
export function UIProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200} skipDelayDuration={100}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
