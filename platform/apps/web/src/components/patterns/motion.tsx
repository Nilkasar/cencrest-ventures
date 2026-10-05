"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { cn, easings } from "@bebest/ui";

/**
 * The one entrance the whole app uses: blocks rise 10px and fade in,
 * staggered 70ms apart, once, on mount. Same values the Overview dashboard
 * was built with, so every page arrives the same way.
 *
 * Reduced motion: `UIProvider` wraps the tree in
 * `<MotionConfig reducedMotion="user">`, which drops the transform and
 * leaves only an instant opacity change — nothing to opt into per page.
 */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easings.emphasized } },
};

export const stackVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

/**
 * Root of a page's body (everything under the `PageHeader`). Vertical
 * rhythm is fixed at 20px between blocks. Direct children that should
 * stagger in are `Section`, `StatGrid`, or anything wrapped in `Reveal`.
 */
export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={cn("flex flex-col gap-5", className)} variants={stackVariants} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

/** Opts one block into the page's stagger. Must sit inside a `PageStack`. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={cn("min-w-0", className)} variants={revealVariants}>
      {children}
    </motion.div>
  );
}
