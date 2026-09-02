/**
 * Motion tokens — the JS/Framer Motion counterpart to the `--ease-*` custom
 * properties in `src/styles/tokens.css`. Keep the two in numeric sync.
 *
 * Philosophy (see DESIGN.md "Motion"): motion here is punctuation, not
 * performance. It confirms cause and effect (a button was pressed, a panel
 * opened) and never runs longer than it takes to be useful. Nothing loops,
 * nothing calls attention to itself, nothing blocks input.
 */

export const durations = {
  /** Micro-feedback: pressed states, checkbox ticks. */
  instant: 0.1,
  /** Default for most enter/exit transitions (menus, tooltips, toasts). */
  fast: 0.16,
  /** Dialogs, drawers, anything that changes a meaningful amount of layout. */
  base: 0.24,
  /** Full-page transitions only. */
  slow: 0.36,
} as const;

/** Cubic-bezier easings, numerically identical to tokens.css `--ease-*`. */
export const easings = {
  /** General purpose UI motion. */
  standard: [0.4, 0, 0.2, 1],
  /** Entrances — starts fast, settles gently. */
  decelerate: [0, 0, 0.2, 1],
  /** Exits — leaves immediately, no lingering. */
  accelerate: [0.4, 0, 1, 1],
  /** The one "designed" easing — confident overshoot-free settle, reserved
   *  for moments that should feel considered (dialogs, the command palette). */
  emphasized: [0.16, 1, 0.3, 1],
} as const satisfies Record<string, [number, number, number, number]>;

type Transition = {
  duration: number;
  ease: readonly [number, number, number, number];
};

const standardTransition: Transition = { duration: durations.fast, ease: easings.standard };
const emphasizedTransition: Transition = { duration: durations.base, ease: easings.emphasized };

/** Ready-made Framer Motion variant objects for the common cases. */
export const motionPresets = {
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: standardTransition,
  },
  fadeUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: emphasizedTransition,
  },
  scaleIn: {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: emphasizedTransition,
  },
  slideInFromRight: {
    initial: { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 16 },
    transition: emphasizedTransition,
  },
  staggerContainer: {
    animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
  },
  staggerItem: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: standardTransition,
  },
} as const;
