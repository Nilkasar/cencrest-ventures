# Epic 0 — Platform Foundation (frontend half)

Status: built, verified locally (typecheck + lint + production build all
pass for both packages; every route smoke-tested at 200 and screenshotted
in light mode). No backend exists yet — nothing here makes a network call.

Scope was the shell and design system only, per the brief: no CRM or
product screens. What follows is a concrete, honest account of what's
real, what's stubbed, and what was deliberately left for later epics.

## What was built

### `platform/packages/ui` (`@bebest/ui`)

A source-only workspace package (no build step — consumed via Next's
`transpilePackages`, the standard pattern for an internal design-system
package in a turborepo monorepo).

- **Tokens** — `src/styles/tokens.css`: a two-layer token system. Raw
  primitives (`ink-0`…`ink-1000` neutral scale, `verdant-50`…`950` accent,
  muted status colors, radius scale, motion easings) live in a Tailwind v4
  `@theme` block. Semantic aliases (`background`, `foreground`, `surface`,
  `border`, `accent`, `ring`, etc.) are plain CSS custom properties on
  `:root`, redefined once under `prefers-color-scheme: dark` and again
  under `[data-theme="dark"]` for the explicit override — then fed back
  into `@theme` so every Tailwind utility (`bg-background`,
  `text-foreground`, `bg-accent`) is theme-aware with zero `dark:` classes
  anywhere in a component. `src/tokens/motion.ts` mirrors the CSS easings
  for Framer Motion, plus a small set of ready-made motion presets.
  `src/tokens/index.ts` also exports layout constants (sidebar width,
  content max-width) and the radius scale as plain JS for non-CSS
  consumers.
- **Primitives** (`src/components/`): Button, Input, Label, Select,
  Dialog, DropdownMenu, Tabs, Tooltip, Table, Badge, Avatar, Card,
  EmptyState, Skeleton (+ `SkeletonText`/`SkeletonAvatar`/`SkeletonCard`
  convenience wrappers), Toast (+ `ToastProvider`/`useToast`). All built on
  Radix UI + `class-variance-authority` + `tailwind-merge`, the same
  composition pattern as the old `web-app/`, rebuilt clean. Menu/dialog/
  toast enter-exit animation is driven by CSS keyframes keyed off Radix's
  `data-state` (not a JS animation library), so Radix's own presence
  detection handles unmounting correctly with no extra plumbing.
- **`UIProvider`** (`src/provider.tsx`): the single mount point for
  `TooltipProvider`, `ToastProvider`, and — the important one —
  `<MotionConfig reducedMotion="user">`, so every Framer Motion animation
  in the app collapses to instant under `prefers-reduced-motion` with zero
  per-component opt-in. This was a flagged, real accessibility gap in the
  old marketing site; it's structurally handled here, not bolted on.
- **`DESIGN.md`** (`platform/packages/ui/DESIGN.md`): the direction in
  plain language — why "Ink" (warm neutral) + "Verdant" (deep botanical
  green, chosen specifically to sit outside the blue/violet AI-SaaS
  default) instead of a gradient; why Fraunces (display) + Inter (UI/body)
  + JetBrains Mono (measurements only); the motion philosophy; the
  composition pattern; and the accessibility baseline every primitive is
  held to (visible focus rings, AA contrast, full keyboard operability,
  errors/toasts announced, not color-only).

Accessibility specifics actually implemented, not just claimed: every
interactive primitive has a real `focus-visible` ring
(`ring-2 ring-ring ring-offset-2`); `Input` wires `aria-invalid` and
`aria-describedby` to its error/description text and renders errors with
`role="alert"`; Dialog/Select/DropdownMenu/Tabs/Tooltip inherit Radix's
focus trapping, roving tabindex, and type-ahead for free; Toast uses
Radix's live-region semantics.

### `platform/apps/web` (`@bebest/web`)

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4
consuming `@bebest/ui`'s tokens directly (`globals.css` imports the
package's `tokens.css` and rebinds the font tokens to the actual
`next/font` variables loaded in `layout.tsx` — Fraunces/Inter/JetBrains
Mono, matching the design system's stated choices).

- **`(auth)` route group**: `/login` (email input, "Continue with email",
  client-side validation, loading state) and `/login/check-email`
  (confirmation screen reading the email from the query string). Editorial
  split layout — dark panel with a Product Vision quote on the left,
  quiet form on the right — rather than a centered card on a gradient.
  Fully responsive (the left panel just disappears below `lg`).
- **`(app)` route group**: `AppShell` (`src/components/shell/`) — a fixed
  dark sidebar with grouped nav, a topbar with org switcher (fixture
  data), theme toggle, and user menu, plus a keyboard-dismissible animated
  mobile drawer (Escape to close, backdrop click to close, proper
  `role="dialog"`/`aria-modal`) and a skip-to-content link.
- **Nav**: Overview, then Intelligence (AI Visibility, SEO Intelligence,
  Competitors, Opportunities), then Execution (Actions, Content, Reports),
  then a new top-level **CRM** section (Leads, Accounts, Deals), with
  Settings pinned above the account footer — matching Stage 4 of
  `docs/09-ux/CUSTOMER_JOURNEY.md` plus the Epic 1 CRM addition called for
  in the brief.
- **Every nav destination renders a real page** — 12 routes, all in
  `src/app/(app)/`, none a 404 or blank div. Each uses `@bebest/ui`'s
  `EmptyState` via a shared `<ComingSoon>` wrapper
  (`src/components/patterns/coming-soon.tsx`) with real, screen-specific
  copy following the CUSTOMER_JOURNEY.md empty-state contract (why it's
  empty, what happens next, a reachable action) and a `Badge` naming which
  future epic (from `platform/EPICS.md`) makes it real. `/settings` goes a
  step further with real `Tabs` (Brand profile / Team / Notifications /
  Billing / Autonomy); the Team tab shows a real `Table` with the current
  (fixture) user, since team/org administration is literally Epic 0's own
  backend domain, not a product screen.
- **Two screens demonstrate the system end-to-end rather than just
  describing it**: `/competitors`'s "Add a competitor" button opens a real
  `Dialog` with a real controlled `Input` and form submit handling; several
  `ComingSoon` actions fire a real `Toast` explaining exactly what's
  missing instead of doing nothing.
- **Theming**: system-by-default via `prefers-color-scheme`, with an
  explicit override set by the topbar's sun/moon toggle, persisted to
  `localStorage`, and applied synchronously before first paint via an
  inline script in `layout.tsx` (no flash). `useTheme`
  (`src/lib/use-theme.ts`) reads it through `useSyncExternalStore` rather
  than mirroring DOM state into a `useEffect`+`setState` pair.
- **`lib/api-client.ts`**: a real `fetch` wrapper (base URL from
  `NEXT_PUBLIC_API_URL`, JSON handling, a typed `ApiError`, credentialed
  requests) that nothing currently calls — the seam for Epic 1+ to wire a
  page in one line instead of a rewrite.
- **`data/fixtures.ts` + `data/types.ts`**: typed placeholder data (one
  fixture user, two fixture orgs) used only by the org switcher and user
  menu chrome. Never persisted, never fetched, and not backed by anything
  that looks like real product data.

## What's stubbed vs. real

**Real**: the entire app shell (sidebar/topbar/mobile drawer), routing for
every nav destination, theming (light/dark + persisted override + no
FOUC), reduced-motion handling, the `Dialog`/`Toast`/`Tabs`/`Table` usage
on `/competitors` and `/settings`, all form validation on `/login` (client
side), the `api-client` abstraction's actual request/error-handling logic.

**Stubbed (explicitly, and said so in the UI itself)**: authentication
(the login form waits 500ms and navigates to the confirmation screen —
nothing is sent anywhere); org switching (changes the displayed label,
scopes no data); every `ComingSoon` page's call-to-action (fires a
`Toast` naming the real blocking epic rather than silently no-op'ing or
navigating somewhere fake); team invites on `/settings`.

## Design decisions (see `packages/ui/DESIGN.md` for the full rationale)

- **Palette** — "Ink" (warm neutral, not clinical gray) + "Verdant" (deep
  botanical green) as the one accent, chosen specifically to avoid the
  blue/violet gradient that is the default skin of nearly every AI product
  built since 2023, while still reading as "growth/ledger" for a product
  literally named a Growth Autopilot.
- **Type** — Fraunces (display/headings only) + Inter (everything else) +
  JetBrains Mono (measurements — scores, timestamps, IDs — never prose).
- **Motion** — `<MotionConfig reducedMotion="user">` at the app root
  instead of per-component reduced-motion checks; CSS-keyframe-driven
  enter/exit for menus/dialogs/toasts instead of a JS animation library, so
  Radix's presence detection "just works."
- **No sparkle/robot/chat-bubble iconography anywhere** — nav icons are
  literal (`lucide-react`: radar, search, target, handshake, etc.), chosen
  to avoid announcing "AI product" on every screen despite the product
  being AI-powered underneath.

## Deferred to Epic 1 (CRM) or later

- Any real CRM data model, list views, or pipeline UI for Leads/Accounts/
  Deals — those pages are `ComingSoon` placeholders by design.
- Any real brand/competitor/AI-visibility/SEO data or scoring — Overview
  and every Intelligence/Execution page are placeholders naming the epic
  (2, 4, 7, 8, 9, 11, 13, 15) that will make them real.
- Real authentication, session, org creation/switching, RBAC, and team
  invites — these depend on Epic 0's *backend* half (being built in
  parallel in `platform/apps/api`), not on anything in this package.
- A component test suite / Storybook for `@bebest/ui` — the package has no
  automated tests yet; `pnpm typecheck` and `pnpm lint` are clean for both
  packages, and the app was manually verified (build + full route smoke
  test + screenshots in light mode) but there's no regression harness yet.
- Dark-mode was implemented structurally (full token scale, verified by
  code review and the light-mode screenshots' construction) but was not
  itself screenshotted in this session — no headless browser scripting
  tool was available to seed `localStorage`/`data-theme` before capture.
  Worth a manual spot-check before this ships.

## Notable implementation fixes made along the way

- `platform/packages/config`'s `eslint.config.mjs` referenced `@eslint/js`
  and `typescript-eslint` without declaring them as dependencies of that
  package — added them (`dependencies` in `packages/config/package.json`)
  since pnpm's strict `node_modules` layout requires a package to declare
  what it actually imports.
- Next.js 16 removed `next lint` and changed the recommended ESLint setup:
  `eslint-config-next` now ships ready-made flat-config arrays
  (`eslint-config-next/core-web-vitals`, `/typescript`) meant to be spread
  directly, not run through `@eslint/eslintrc`'s `FlatCompat` — the
  `FlatCompat` approach (still what most tutorials show) crashes with a
  circular-structure error against this version. `apps/web/eslint.config.mjs`
  uses the direct-import form per Next's own bundled docs
  (`node_modules/next/dist/docs/.../03-eslint.md`).
- `useTheme` originally read theme state via `useEffect` + `setState`,
  which the current `eslint-plugin-react-hooks` flags (`set-state-in-effect`)
  as the wrong pattern for mirroring external state; rewritten on
  `useSyncExternalStore`, which is both the lint-approved and the more
  correct approach for state that actually lives in the DOM/localStorage.
