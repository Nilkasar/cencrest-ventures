export * from "./motion";

/** Layout constants shared by the app shell. Kept here (not CSS) because
 *  they're consumed by both Tailwind arbitrary values and plain JS layout
 *  math (e.g. positioning a popover relative to the topbar). */
export const layout = {
  sidebarWidth: 264,
  sidebarWidthCollapsed: 72,
  topbarHeight: 64,
  contentMaxWidth: 1180,
} as const;

/** Radius scale, mirrored from tokens.css `--radius-*` for JS contexts
 *  (e.g. inline SVG, canvas, or charting code that can't read CSS vars). */
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
  full: 999,
} as const;
