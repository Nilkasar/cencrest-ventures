"use client";

import { useEffect, useState } from "react";

/** Tracks `prefers-reduced-motion` live. Framer Motion trees should prefer
 *  wrapping in `<MotionConfig reducedMotion="user">` (see apps/web
 *  providers) — this hook is for the rare case of hand-rolled JS animation
 *  (canvas, rAF loops) that MotionConfig can't reach. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return reduced;
}
