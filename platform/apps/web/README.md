# @bebest/web

The BeBest customer portal — Next.js 16 (App Router), React 19, TypeScript,
Tailwind v4, styled entirely through `@bebest/ui`. This is the Epic 0
("Platform Foundation") build: the app shell and design system, with every
screen either a real, wired shell component or a deliberately designed
placeholder. There is no CRM or product data in this epic.

## Running it

From the monorepo root:

```bash
pnpm install
pnpm --filter @bebest/web dev
```

Or from this directory: `pnpm dev`. Opens on `http://localhost:3000` and
redirects to `/overview`.

No environment variables are required to run the app in this epic — there
is no backend to point it at yet (see "What's stubbed" below).

## What's real

- **App shell**: sidebar nav (`src/components/shell/sidebar.tsx`, with a
  proper animated/keyboard-dismissible mobile drawer), topbar with org
  switcher, theme toggle, and user menu (`src/components/shell`).
- **Every nav destination renders a real page** — `src/app/(app)/*/page.tsx`
  — never a 404 or a blank div. Most are `<ComingSoon>` placeholders built
  from `@bebest/ui`'s `EmptyState`, following the empty-state contract in
  `docs/09-ux/CUSTOMER_JOURNEY.md` (explain why it's empty, say what to do,
  make the action reachable — see `src/components/patterns/coming-soon.tsx`).
- **Theming**: light/dark, system-by-default with a persisted override
  (`src/lib/use-theme.ts` + the inline script in `layout.tsx` that applies
  it before first paint). Try the sun/moon toggle in the topbar.
- **Reduced motion**: the whole app is wrapped in `@bebest/ui`'s
  `<UIProvider>`, which sets Framer Motion's `reducedMotion="user"` once
  for every animated component — no per-component opt-in needed.
- **A few components are wired to real (if inert) interactions** to prove
  the design system works end to end: the "Add a competitor" dialog on
  `/competitors` is a real `<Dialog>` + `<Input>` + form; several
  placeholder pages fire a real `<Toast>` explaining what's missing instead
  of doing nothing when you click their call-to-action.

## What's stubbed

- **Auth** (`src/app/(auth)/login`): the login form and "check your email"
  confirmation are visual-only. Submitting waits half a second (to show
  the loading state) and then navigates straight to the confirmation
  screen — no request is sent anywhere. Wiring this to Epic 0's real auth
  service is a small change to `handleSubmit` in
  `src/app/(auth)/login/page.tsx`.
- **`lib/api-client.ts`**: a real `fetch` wrapper (base URL, JSON handling,
  a typed `ApiError`) that nothing currently calls. It exists so that
  wiring a real page next epic is `apiClient.get<Lead[]>("/crm/leads")`,
  not a rewrite.
- **`data/fixtures.ts`**: typed placeholder data (a current user, two
  organizations) used only to give the org switcher and user menu
  something to display. Never persisted, never fetched.
- **Org switching**: the topbar org switcher changes what's displayed
  locally but doesn't scope any data or navigate — there's no per-org data
  yet to scope to.
- **Every `<ComingSoon>` page** is explicit in its own copy about which
  future epic (see `platform/EPICS.md`) will make it real.

## Structure

```
src/
  app/
    (auth)/            — login, check-email (no chrome, editorial split layout)
    (app)/             — authenticated shell: layout.tsx mounts <AppShell>
      overview/ ai-visibility/ seo-intelligence/ competitors/
      opportunities/ actions/ content/ reports/ settings/
      crm/leads/ crm/accounts/ crm/deals/
  components/
    shell/             — sidebar, topbar, org switcher, theme toggle, user menu
    patterns/          — page-header, coming-soon, stub-action-button
  data/                — nav config, fixtures, and their types
  lib/                 — api-client stub, theme helpers
```

## Design system

All visual decisions (palette, type, motion, composition pattern) live in
`platform/packages/ui/DESIGN.md`. Read it before adding a new component or
a one-off style — the goal is that nothing in this app ever reaches for a
raw hex value or an ad-hoc `dark:` class.
