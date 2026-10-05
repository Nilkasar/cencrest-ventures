# Page anatomy — the guide every page follows

This is the contract for how a page in the BeBest web app is put together.
If five people build five pages from this file independently, the result
must look like one product. When this guide and an older page disagree,
this guide wins. When this guide is silent, copy the Overview
(`components/overview/`) and the worked examples below; do not invent.

**Worked examples:** CRM Leads list (`components/crm/leads-view.tsx` +
`app/(app)/crm/leads/page.tsx`) and Lead detail
(`components/crm/lead-detail-view.tsx`). Open them next to this file.

Everything here is exported from `@/components/patterns` (barrel) or the
individual files in this folder. Primitives (Button, Badge, Table, Tabs,
Select, Dialog, EmptyState, Skeleton, Pagination, …) come from `@bebest/ui`.

---

## 1. Global rules

1. **One header rule.** Dashboards (the Overview, and any page whose job
   is "how am I doing at a glance") have **no visible page header**; the
   topbar breadcrumb names them. **Every other page opens with
   `PageHeader`** (index/list/settings/report pages) **or `DetailHeader`**
   (one entity). Never hand-roll an `<h1>`.
2. **Don't pass `eyebrow` to `PageHeader`.** The breadcrumb already shows
   the group ("CRM", "Intelligence"). The prop exists only for old callers.
3. **One page body root: `PageStack`.** It owns the vertical rhythm (20px)
   and the single entrance animation. Its direct blocks are `Section`,
   `StatGrid`, `Toolbar`, or anything wrapped in `Reveal`.
4. **One card chrome: `Section`.** Don't compose `Card + CardHeader +
   CardTitle` on new work — `Section` is the same look as the Overview's
   `Panel` and joins the stagger.
5. **Content width is the shell's** (1180px max, set by `AppShell`). Never
   add your own `max-w-*` page wrapper, except the report/document type
   (§3.6).
6. **Real data only.** No sample numbers, no placeholder rows. A missing
   value is "—" (`&mdash;`), never 0 unless the API said 0.
7. **Every fetch has four designed states:** loading (skeleton shaped like
   the result), error (`ErrorPanel` with retry), empty (`EmptyState` per
   §7), success. Refetches keep content on screen behind `RefreshOverlay`
   (`useAsyncData` already exposes `isRefreshing`).
8. **No `dark:` classes, no hex values.** Semantic tokens only (§5).

---

## 2. Components (one line each)

| Component | File | Props (key ones) |
|---|---|---|
| `PageHeader` | page-header.tsx | `title`, `description?`, `actions?`, `meta?`, `tabs?`, `className?` (`eyebrow?` deprecated) |
| `DetailHeader` | page-header.tsx | `backHref?`, `backLabel?`, `leading?`, `title`, `badges?`, `subtitle?`, `meta?: {label,value,icon?}[]`, `actions?`, `tabs?` |
| `PageStack` | motion.tsx | `children`, `className?` — stagger root, `gap-5` |
| `Reveal` | motion.tsx | `children`, `className?` — opts a block into the stagger |
| `revealVariants` / `stackVariants` | motion.tsx | the Framer variants, for custom motion blocks |
| `Section` | section.tsx | `title?`, `description?`, `eyebrow?`, `icon?`, `actions?`, `footer?`, `flush?`, `id?`, `className?`, `bodyClassName?` |
| `PropertyList` | section.tsx | `items: {label, value: ReactNode \| null, icon?}[]` — `<dl>` for side rails |
| `StatGrid` | stat-tile.tsx | `columns?: 2\|3\|4` (default 4) |
| `StatTile` | stat-tile.tsx | `label`, `value`, `hint?`, `delta?: {value, tone, label?}`, `icon?`, `href?`, `loading?`, `muted?` |
| `Toolbar` | toolbar.tsx | `children` (search + filters, left), `end?` (count, view toggle, "New" action, right) |
| `ToolbarSearch` | toolbar.tsx | `value`, `onChange`, `label` (a11y name), `placeholder?` — Esc and × clear |
| `FilterSelect` | toolbar.tsx | `value`, `onValueChange`, `options: {value,label}[]`, `label` |
| `ClearFiltersButton` | toolbar.tsx | `onClick` — render only while a filter is active |
| `ResultCount` | toolbar.tsx | `count`, `noun`, `pluralNoun?` — server total, `aria-live` |
| `ViewToggle` | toolbar.tsx | `value`, `onChange`, `options: {value,label,icon}[]` — radio group |
| `ClickableRow` | data-table.tsx | `href` — whole row clickable, cmd/ctrl-click opens a tab |
| `CellLink` | data-table.tsx | `href` — the primary cell's real link (keyboard path) |
| `SortableHead` | data-table.tsx | `direction: "asc"\|"desc"\|false`, `onSort`, `align?` — sets `aria-sort` |
| `TableSkeleton` | data-table.tsx | `columns: {header, cell?: "text"\|"entity"\|"badge"\|"number"\|"meta", align?}[]`, `rows?`, `framed?`, `label?` |
| `TableEmptyRow` | data-table.tsx | `colSpan`, `children` — for tables that keep their header when empty |
| `NoResults` | states.tsx | `noun` (plural), `onClear`, `hint?` |
| `SectionSkeleton` | states.tsx | `lines?`, `titleWidth?` |
| `DetailSkeleton` | states.tsx | `withLeading?`, `label?` — whole detail page |
| `ErrorPanel` | error-panel.tsx | `message`, `onRetry`, `title?`, `compact?` |
| `DetailLayout` | layout.tsx | `children` (main), `aside?` (320px rail) |
| `SplitLayout` | layout.tsx | two equal columns of Sections |
| `BoardColumn` / `BoardColumnEmpty` | layout.tsx | `title`, `count`, `meta?`, `highlighted?` + DnD div props |
| `FormSection` | form-layout.tsx | `title`, `description?`, `actions?`, `footer?` |
| `FormRow` | form-layout.tsx | `label`, `htmlFor?`, `description?`, `error?`, `required?` |
| `LinkTabs` | link-tabs.tsx | `tabs: {href,label,count?,exact?}[]`, `label` |
| `typography` | typography.ts | class strings for the type scale (§4) |
| `ComingSoon`, `RouteError`, `RouteNotFound`, `StubActionButton` | (unchanged) | |

`@bebest/ui` additions you should use: `Badge variant="info"`,
`<Table framed={false}>` (flush inside a `Section flush`),
`<TabsList variant="underline">` (page-level tabs).

---

## 3. Page types

### 3.1 Dashboard ("How am I doing?") — e.g. Overview, AI Visibility summary

```
(no header — breadcrumb names it)
PageStack
  ├─ hero Section (the score, with its formula + evidence one click away)
  ├─ StatGrid columns={4}           ← 4 KPI StatTiles, each href → owning screen
  ├─ grid 12-col: Section span-7 | Section span-5
  └─ …
```
- Use the Overview's `Panel`/`AnimatedNumber`/`SrTable` from
  `components/overview/primitives.tsx` when a widget needs its own fetch
  states; `Section` otherwise. Same chrome either way.
- Grids: `grid grid-cols-1 lg:grid-cols-12 gap-5`, spans 7/5 or 8/4 or 6/6.
- Every chart ships an `SrTable` and follows the `dataviz` skill.

### 3.2 List / index — e.g. Leads, Accounts, Opportunities, Reports, Content

```tsx
// app/(app)/crm/leads/page.tsx (server)
<PageHeader title="Leads" description="One sentence: what this list is." />
<LeadsView />

// LeadsView (client)
<PageStack>
  <StatGrid>{/* 2–4 StatTiles from API totals; loading={!data} */}</StatGrid>
  <Toolbar end={<><ResultCount count={total} noun="lead" /><AddLeadDialog … /></>}>
    <ToolbarSearch … label="Search leads" />
    <FilterSelect … label="Filter by status" />
    {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
  </Toolbar>
  <Reveal>
    {loading && <TableSkeleton columns={COLUMNS} />}
    {error && <ErrorPanel title="Leads didn't load" message={…} onRetry={reload} />}
    {firstRun && <EmptyState … />}             {/* no data at all — hide StatGrid + Toolbar */}
    {filteredEmpty && <NoResults noun="leads" onClear={clearFilters} />}
    {rows && <RefreshOverlay active={isRefreshing}><Table>…</Table><Pagination … /></RefreshOverlay>}
  </Reveal>
</PageStack>
```
- **Where the "New …" action goes:** at the right end of the `Toolbar`
  (it's coupled to the list's `reload`). `PageHeader.actions` is for
  page-level actions not tied to one list: Recompute, Export, Print.
- One `Reveal` wraps the whole results region, so the skeleton fades in
  once and the table replaces it in place (no second animation).
- Lists of rich items (opportunity cards) instead of a table: a
  `Section flush` containing `<ul className="divide-y divide-border">`,
  each `<li>` padded `px-5 py-4`.

### 3.3 Detail — e.g. Lead, Deal, Account, Agent run, Content draft

```tsx
if (loading) return <DetailSkeleton />;
if (error)   return <><DetailHeader backHref=… backLabel="Leads" title="Lead" /><ErrorPanel … /></>;
if (!entity) return <EmptyState title="Lead not found" … action={Back to leads} />;
<>
  <DetailHeader
    backHref="/crm/leads" backLabel="Leads"
    leading={<Avatar size="lg" … />}           // or a 48px icon tile
    title={lead.name}
    badges={<LeadStatusBadge … size="sm" />}
    subtitle="Company · email"
    meta={[{label:"Owner",value:…},{label:"Created",value:formatDate(…)}]}  // 2–5 facts
    actions={<>{secondary}<Primary /></>}
  />
  <PageStack>
    <DetailLayout aside={<><Section title="Pipeline">…</Section><Section title="Contact"><PropertyList …/></Section></>}>
      <Section title="Activity">…</Section>     // the entity's main story
    </DetailLayout>
  </PageStack>
</>
```
- Main column: the thing itself and its history (activity, evidence,
  draft body, run steps). Rail: properties, status controls, related
  records (as a `Section flush` with a divided link list).
- Detail pages with sub-views: pass `tabs={<TabsList variant="underline">…}`
  or `<LinkTabs>` to `DetailHeader`.

### 3.4 Kanban / board — e.g. Deals

```
PageHeader
PageStack
  ├─ StatGrid columns={3}   (pipeline value, weighted, won — from API rows)
  ├─ Toolbar (search, owner filter | ViewToggle board/table, "New deal")
  └─ Reveal → <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                {stages.map(s => <BoardColumn title count meta highlighted {...dndHandlers}>
                   {cards.length ? cards : <BoardColumnEmpty highlighted>Drop a deal here</BoardColumnEmpty>}
                 </BoardColumn>)}
```
- Cards: `Card` with `p-3.5`, title 13px medium, value in
  `typography.numeric`, a single meta line. Every drag has a keyboard
  equivalent (a "Move to…" menu on the card).

### 3.5 Settings / form — e.g. Settings tabs, Brand profile, Connectors

```tsx
<PageHeader title="Settings" description="…" tabs={<TabsList variant="underline">…</TabsList>} />
<PageStack>
  <FormSection title="Brand" description="How AI models should know you."
    footer={<><Button variant="ghost" size="sm">Cancel</Button><Button size="sm" loading={saving}>Save changes</Button></>}>
    <FormRow label="Company name" htmlFor="name" description="As customers say it." error={errors.name?.message} required>
      <Input id="name" {...register("name")} />
    </FormRow>
  </FormSection>
</PageStack>
```
- When the page itself is tabbed (Settings), put the `<Tabs>` root around
  `PageHeader` + content and pass the `TabsList` via `tabs`.
- React Hook Form + zod resolver mirroring the API schema; errors go in
  `FormRow.error` (announced). Save button disabled until dirty.
- Read-only summaries of saved data: `Section` + `PropertyList` with an
  "Edit" ghost button in `actions`.

### 3.6 Report / document — e.g. Report detail, Snapshot report

- `DetailHeader` (back to Reports, title, type badge, `meta`: period,
  generated date) with Print as a secondary action.
- Body: `PageStack` inside `<div className="mx-auto w-full max-w-[880px]">`
  — the one place a narrower measure is allowed (reading width).
- Sections in document order; headline numbers as a `StatGrid`;
  `SplitLayout` for paired panels. Mark chrome `data-print-hide`.

### 3.7 Wizard — e.g. Onboarding

- Lives outside the app shell's content conventions: centered column
  `max-w-[640px] mx-auto`, existing `components/onboarding/stepper.tsx`
  on top, one `Section` per step, `step-actions.tsx` footer (Back ghost
  left, Continue primary right). One question per step; progress is
  always visible; leaving is always safe (state persists).

---

## 4. Typography (exact classes — use `typography.*`)

| Role | Class string (`typography.` key) | Use |
|---|---|---|
| Page / entity title | `pageTitle` — Fraunces 22px semibold, -0.015em | the one `<h1>` |
| Section title | `sectionTitle` — Fraunces 15.5px semibold | `<h2>` in `Section` |
| Eyebrow | `eyebrow` — JetBrains Mono 10.5px, uppercase, 0.12em, subtle | labels over values, stat labels; never sentences |
| Body | `body` — Inter 13.5px, relaxed | prose |
| Secondary | `secondary` — Inter 13px muted | descriptions, empty-state bodies |
| Meta | `meta` — Inter 12px muted | timestamps, small facts |
| Numeric (dense) | `numeric` — Mono 12.5px tabular | table numbers, money in lists, IDs |
| Stat value | `statValue` — Inter 26px semibold, tabular | `StatTile` value |

Table cell text is 13px (set by `Table`); table headers 11px uppercase
(set by `TableHead`). Fraunces is **only** for titles and hero numerals —
never buttons, labels, table cells, or badges.

## 5. Spacing & color

- Spacing scale (Tailwind units): **1 (4px) · 2 (8px) · 3 (12px) · 4
  (16px) · 5 (20px) · 6 (24px)**. Page blocks `gap-5`; tile grids
  `gap-4`; header → body `mb-6` (built into the headers); Section padding
  `px-5 pt-4 pb-5`; toolbar controls `gap-2`; inline icon+text `gap-1.5`.
- Radius: cards/tables/panels `rounded-xl`; controls `rounded-md`;
  pills/avatars `rounded-full`. Control height 36px (`h-9`) in toolbars,
  32px (`size="sm"`) for buttons in headers/sections.
- Surfaces: page = `bg-background`; cards = `bg-surface-raised` (via
  `Card`/`Section`/`Table`); recessed areas (table header, inactive chips,
  footers) = `bg-surface`. Borders `border-border`; hover border
  `border-border-strong`.
- Text: `text-foreground` (primary), `text-muted-foreground` (secondary),
  `text-subtle-foreground` (meta/placeholder only — not for body text).
- **Accent (verdant) only for:** primary buttons, links, active
  nav/tab indicator, focus rings, and the "you" series in charts. Never as
  a decorative fill, never for a status.
- Status colors only via the tones in §6. Never red text for emphasis.

## 6. Badges & status tones

Statuses are `Badge` with `dot` and `size="sm"` in tables/rails, `md`
in headers. Categorical tags (source, type, channel) are
`variant="outline"` with no dot. Map every domain status to a tone by
meaning, not by hue preference:

| Tone (`variant`) | Meaning | Examples |
|---|---|---|
| `neutral` | not started / inert | New, Draft, Queued, Not started, Archived, Dismissed |
| `info` | in motion, nobody needs to act | Contacted, Qualifying, Proposal, Negotiation, Running, In progress, Scheduled |
| `warning` | waiting on a human / at risk | Qualified (convert it), Awaiting approval, Needs review, Degraded, Expiring |
| `success` | done, good outcome | Converted, Won, Completed, Approved, Healthy, Connected |
| `danger` | failed / bad outcome | Lost, Failed, Rejected, Error, Critical, Disconnected |
| `accent` | **only** "recommended" / "you" markers | Recommended, Your brand |

Keep each domain's map in one file next to its data (like
`components/crm/status-badges.tsx`) — never inline a variant choice in a
page.

## 7. Empty, loading, error

**Empty-state copy pattern** (`EmptyState` from `@bebest/ui`):
- `title`: what's missing, plainly — "No leads yet", "No reports yet".
- `description`: **why** it's empty + **what happens next** in ≤ 2
  sentences — "Opportunities appear after your first baseline run (about
  20–60 minutes). Add competitors to find more gaps."
- `action`: the one thing that fixes it, as a real button/link (the same
  dialog/route the page already uses). `secondaryAction` optional.
- No `eyebrow` on page-level empty states. `compact` inside a `Section`.
- Filtered-to-nothing is different: `NoResults` ("No leads match these
  filters" + Clear filters).

**Loading:** skeletons shaped like the final layout — `TableSkeleton`
with the real headers, `StatTile loading`, `SectionSkeleton`,
`DetailSkeleton`. Never a centered spinner for a page; never
`return null`. Long-running jobs show step progress (agent events), not a
skeleton.

**Error:** `ErrorPanel` with a specific `title` ("Leads didn't load") and
the API's message; `compact` for a failure inside a working page (a
mutation, one rail section). Mutations failing → `toast({ variant:
"danger" })` with what to do.

## 8. Numbers & dates (`lib/format.ts`)

| Value | Helper | Output |
|---|---|---|
| counts | `formatNumber(n)` | 12,480 |
| counts in tiles when ≥ 10,000 | `formatCompactNumber(n)` | 12.5K |
| money (cents) | `formatCurrency(c)` / `formatCompactCurrency(c)` (tiles) | $48,000 / $48K |
| 0–100 percent | `formatPercent(v, decimals?)` | 42% |
| change | `formatDelta(v, decimals?, unit?)` | +4 pts · −2.5% (true minus) |
| date | `formatDate(iso)` | Oct 4, 2026 |
| date+time | `formatDateTime(iso)` | Oct 4, 2026, 3:12 PM |
| recency in lists | `formatRelativeTime(iso)` | 3 days ago |

Scores are integers out of 100 — show `72`, with "/100" only in the hero.
Numbers in tables are right-aligned (`className="text-right"` on head +
cell) in `typography.numeric` (or a component like `LeadScore`). Deltas
color by meaning (`tone: "positive"|"negative"`) — for metrics where down
is good, pass the tone, don't trust the sign.

## 9. Tables

- `Table` is framed by default (raised card). Inside a `Section flush`
  use `<Table framed={false}>`.
- Row → detail page: `ClickableRow href` + `CellLink` in the first cell.
  **Don't** put `role="link"`/`tabIndex` on a `<tr>` (breaks table
  semantics); don't `router.push` from cells.
- Hover tint and header style come from the primitive — don't override.
- Column order: identity → status → numbers → owner → time. Max ~7
  columns; secondary info as a second line (12px muted) under the name.
- Sticky header only inside a fixed-height scroll region
  (`containerClassName="max-h-[480px] overflow-y-auto"` + `className`
  `[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10`). Page-level tables
  paginate (`Pagination`) instead.
- Sorting is server-side where the API supports it; use `SortableHead`.

## 10. Tabs

- **Page-level sections** (Settings, a detail page's sub-views):
  `<TabsList variant="underline">` passed to the header's `tabs`, or
  `LinkTabs` when each tab is a route.
- **In-panel view switches** (7d/30d/90d, model filter): default
  segmented `TabsList` inside a `Section`'s `actions`.
- **Data view switch** (table ↔ board): `ViewToggle` in the toolbar.

## 11. Motion

One entrance: `PageStack` + `Section`/`StatTile`/`Reveal` (rise 10px +
fade, 0.5s emphasized ease, 70ms stagger, once). Everything else is
state feedback only: hover lift on link tiles (`-translate-y-0.5`),
`RefreshOverlay` fade on refetch, Radix enter/exit on overlays. Reduced
motion is handled globally (`MotionConfig reducedMotion="user"` + the CSS
media query) — don't add per-component checks unless you drive values
imperatively (`useReducedMotion`, like `AnimatedNumber`). Never animate
on scroll, never loop decoratively, never animate layout properties.

## 12. Accessibility checklist (per page)

- One `<h1>` (from the header), `<h2>` per Section; `aria-labelledby` is
  wired by `Section`.
- Every icon-only button has `aria-label`; every decorative icon
  `aria-hidden`.
- Every filter/search has an accessible name (`label` prop).
- Focus is visible on every interactive element (primitives do this — if
  you style a raw `<a>`/`<button>`, add `focus-visible:ring-2
  focus-visible:ring-ring`).
- Status never by color alone — badges carry text.
- Touch: interactive targets ≥ 32px with ≥ 8px separation; primary
  page actions ≥ 36px.

## 13. Do / Don't

```tsx
// ✗ Don't — hand-rolled header with eyebrow and one-off sizes
<p className="font-mono text-[11px] uppercase">CRM</p>
<h1 className="text-[26px] font-display">Leads</h1>
// ✓ Do
<PageHeader title="Leads" description="…" />

// ✗ Don't — Card + CardHeader + CardTitle per block
<Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent>…</CardContent></Card>
// ✓ Do
<Section title="Activity" description="Newest first.">…</Section>

// ✗ Don't — local StatCard with mono 22px
<StatCard label="Total" value={String(n)} />
// ✓ Do
<StatGrid columns={3}><StatTile label="Leads" value={formatNumber(n)} hint="In the pipeline" /></StatGrid>

// ✗ Don't — counting the current page's rows
value={rows.filter(r => r.status === "new").length}
// ✓ Do — API totals (statusCounts / pagination.total)

// ✗ Don't — bare loading
if (loading) return null;
// ✓ Do
{loading && <TableSkeleton columns={COLUMNS} />}

// ✗ Don't — color as decoration
<p className="text-accent font-semibold">Great news!</p>
// ✓ Do — accent only on actions/links/active indicators
```
