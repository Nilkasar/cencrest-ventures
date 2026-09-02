// Shared motion presets for consistent premium animation across the app.
// Reference: Linear, Vercel dashboard, Attio — subtle, purposeful, 150–300ms,
// cubic-bezier ease-out. Also see src/design-system/motion.ts for the
// design-system-level presets bound to token durations.

export const SPRING_CURVE = [0.16, 1, 0.3, 1] as const

type Ease = [number, number, number, number]
const EASE = SPRING_CURVE as unknown as Ease

/** Page/section mount: fade + rise, with per-index stagger. */
export const fadeUp = (i: number = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: EASE, delay: i * 0.06 },
})

/** List item mount: shorter distance + tighter stagger than fadeUp. */
export const listItem = (i: number = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE, delay: i * 0.05 },
})

/** Card hover: soft shadow lift + border darken. */
export const cardHover =
  'transition-all duration-200 ease-out hover:shadow-[0_4px_16px_rgba(22,20,15,0.08)] hover:border-border-strong'

/** Recharts animation defaults. */
export const chartAnimation = {
  animationDuration: 800,
  animationEasing: 'ease-out' as const,
}
