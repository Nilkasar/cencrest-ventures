# @bebest/ui — Design Direction

This is the design system for the BeBest customer portal: CMOs and founders
paying $24k–$65k for evidence that AI models recommend their competitors
instead of them. They are not shopping for another AI-flavored SaaS tool —
they're used to Bloomberg terminals, private-banking portals, and board
decks. The interface has to earn trust the way those do: through precision,
restraint, and legibility under pressure, not through motion or decoration.

This document exists so the direction survives contact with the next
contributor. If you're about to add a gradient, a glass panel, a sparkle
icon, or a chat bubble, read this first.

## What we're deliberately not doing

- **No purple/blue gradient hero blocks.** That palette is the default
  skin of every AI product built since 2023. It reads as "generic AI SaaS"
  the instant it appears, regardless of what's underneath it.
- **No glassmorphism.** Frosted, translucent panels borrow visual interest
  they haven't earned. Elevation here comes from real shadow and a real
  surface color change, not a blur filter.
- **No sparkle/robot/chat-bubble iconography.** The product is powered by
  AI; the *interface* should not announce that on every screen. Icons are
  plain, literal, and borrowed from `lucide-react` — targets, radar,
  ledgers, not wands or bots.
- **No motion for its own sake.** Nothing loops, nothing floats, nothing
  animates on scroll just to prove the page is alive.

## Palette: "Ink" + "Verdant"

Two families, defined as full 0–1000 scales in `src/styles/tokens.css`:

- **Ink** — a warm neutral scale (`#faf9f6` → `#0d0a07`) used for
  background, surface, text, and borders in both themes. It is warm on
  purpose: pure grayscale reads clinical and cold; a whisper of brown/ochre
  in the neutral scale reads like paper and ledger stock, which is the
  register we want (private banking, not a hospital dashboard).
- **Verdant** — one considered accent, a deep botanical green
  (`#2f664a` in light mode, `#5c9c78` in dark mode for contrast). It is the
  *only* saturated color in the system apart from semantic status colors.
  Green was chosen specifically because it sits outside the blue/violet
  default that almost every AI product reaches for, while still carrying
  the right connotation for a product literally named "Growth Autopilot" —
  ledgers, growth, money, evidence in the black. It appears on primary
  actions, active nav state, links, and focus rings — nowhere else. If a
  screen needs a second accent, that's a sign it should use a neutral +
  weight/size change instead, not a second hue.
- **Status colors** (`success`/`warning`/`danger`/`info`) are muted,
  desaturated versions of the expected hues — enough to be legible at a
  glance in a data table, not bright enough to compete with Verdant for
  attention.

Every token is defined twice: once as a light-mode value on `:root`, once
under `prefers-color-scheme: dark` and `[data-theme="dark"]`. Nothing in a
component ever hardcodes a hex value or branches on `dark:` — components
consume the semantic aliases (`bg-background`, `text-foreground`,
`border-border`, `bg-accent`) and the theme layer does the rest. See
"Theming" below.

## Typography: Fraunces + Inter (+ JetBrains Mono for numbers)

- **Fraunces** for display and heading text. It's a serif with a wide
  optical-size axis and real personality — it's what makes a page header
  read as "editorial report" instead of "web app chrome." Reserved for
  headings and a small number of hero numerals; never used for UI chrome
  (buttons, nav, form labels), which would tip it from "considered" into
  "twee."
- **Inter** for everything else — body copy, labels, buttons, nav, table
  content. It's the load-bearing, boring choice on purpose: mature hinting
  at 12–13px, real tabular figures, and total familiarity means it gets out
  of the way of the numbers and evidence the product exists to show.
- **JetBrains Mono** for anything that is a *measurement* rather than
  prose: scores, percentages in a table cell, timestamps, IDs. A monospaced
  numeral is a small, deliberate signal that "this number was measured, not
  written" — appropriate for a product whose entire pitch is evidence over
  opinion.

Type sizes are kept in the 11–19px range for UI text (see component
source for exact scale) with one or two larger display sizes for page
titles and score numerals. There is no 40px hero headline anywhere in this
package — that belongs to the marketing site, not the operating portal.

## Motion: punctuation, not performance

Motion tokens live in `src/tokens/motion.ts` (JS/Framer Motion) and as
`--ease-*` custom properties in `tokens.css` (kept numerically identical).
Two rules:

1. **Motion confirms cause and effect and nothing else.** A button press
   settles at 0.975 scale. A dialog enters over ~200ms with a decisive,
   overshoot-free ease (`emphasized`, `cubic-bezier(0.16, 1, 0.3, 1)`) and
   leaves in under 150ms with no ease-out lingering — exits should never
   feel slower than entrances.
2. **`prefers-reduced-motion` is load-bearing, not a checkbox.** Every
   Framer Motion tree in the app is wrapped once in
   `<MotionConfig reducedMotion="user">` (via `<UIProvider>`, mounted at
   the app root) — this makes every animated component in the app collapse
   to an instant state change automatically when the OS setting is on,
   with zero per-component opt-in. Plain CSS transitions/animations
   (dialog/menu/toast enter-exit, which are CSS-keyframe driven so Radix's
   own presence detection works without a JS animation library) are
   covered separately by the blanket `@media (prefers-reduced-motion:
   reduce)` override at the bottom of `tokens.css`. This was a real,
   flagged accessibility gap in the previous marketing site — it does not
   get repeated here.

## Elevation & radius

Shadows are warm-tinted (`rgb(22 18 13 / …)` in light mode, true black in
dark mode) rather than the default browser gray — consistent with the warm
neutral palette. Radius tops out at 20px on cards; most interactive
elements (buttons, inputs, menu items) use 6–8px. Nothing is fully rounded
except avatars, dots, and pills — a fully-rounded card or button reads as
consumer/social, not instrument-grade.

## Composition pattern

Every primitive follows the same recipe, carried over from the previous
implementation because it's a good pattern, just built cleanly this time:

- **Radix UI** for behavior and accessibility (focus trapping, roving
  tabindex, ARIA wiring) — never reimplemented by hand.
- **class-variance-authority (cva)** for variant/size props with real
  TypeScript types via `VariantProps`.
- **tailwind-merge** (via the shared `cn()` helper) so consumers can
  override any class without specificity fights.
- **`asChild`/`Slot`** where Radix supports it, so composition doesn't
  require an extra wrapper element.

## Theming

Default: the system follows the OS via `prefers-color-scheme`. The app
also supports an explicit override — `<html data-theme="dark">` or
`data-theme="light"` — set by the theme toggle in the topbar and persisted
to `localStorage`. This is a real requirement, not decoration: this
product will be open on a external-facing screen or dark-mode monitor as
often as it's open on a laptop at 2pm, and it cannot look unfinished in
either state. No component in this package should ever assume a single
theme.

## Accessibility baseline (non-negotiable)

- Every interactive primitive has a visible `:focus-visible` ring
  (`ring-2 ring-ring ring-offset-2`), not just a browser default outline.
- Color pairs used for text (`foreground`/`background`,
  `accent-foreground`/`accent`, each status color on its `-muted`
  background) are checked for WCAG 2.1 AA contrast (4.5:1 body text, 3:1
  large text/UI components) in both themes.
- Everything is operable by keyboard: dialogs trap and restore focus,
  menus/select support arrow-key + type-ahead navigation (inherited from
  Radix), and no click handler exists without a keyboard-reachable
  equivalent.
- Toasts and form errors are announced (`role="alert"` on inline errors,
  Radix Toast's built-in live region) rather than conveyed by color alone.
