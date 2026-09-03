# Epic 15 — Reporting & Notifications (frontend): completion summary

Frontend-only, per this task's brief — `platform/apps/web` (`@bebest/web`).
Branch `rebuild/platform`, nothing under `api/`, `web-app/`, or the
repo-root marketing site was touched. Backend was already VERIFIED
(`15-reporting-notifications-backend.md`) — every route handler, Prisma
field, and response shape below was read directly from
`platform/apps/api/src/{routes,lib}/{reporting,notifications}` and
`packages/database/prisma/schema.prisma` before writing any client code,
per this project's standing "no fixture layer, wire against the real
backend" rule. No git commands were run.

---

## What was built

### Data layer (`src/data/reporting/`, `src/data/notifications/`)

- **`data/reporting/types.ts`** — `Report`/`ReportSummary`/`ReportContent`
  (`StandardReportContent | BaselineComparisonContent`)/`ScoreDeltaResult`/
  `CompetitorMovementEntry`/`GenerateReportInput`, mirroring
  `lib/reporting/{serialize,generate-report,sections}.ts` and
  `routes/{reports,report-details}.ts` field-for-field. Deliberately reuses
  rather than forks: `ScoreSnapshot`/`GeoScoreComponent` from Epic 14's
  already-shipped `data/measurement/types.ts` (baseline/current on a
  `baseline_comparison` report are the literal same shape `measurements.
  before_score`/`.after_score` already use client-side), and
  `MovementResult` from Epic 8's `data/competitive-intelligence/types.ts`.
- **`data/reporting/client.ts`** — `listReports()` (`GET
  /brands/me/reports`, type/limit/offset), `generateReport()` (`POST
  /brands/me/reports/generate`), `getReport()` (`GET /reports/:id`).
  `NoBrandProfileError`/`ReportNotFoundError` mirror the
  `NoBrandProfileError`/`OpportunityNotFoundError` precedent from
  `data/opportunities/client.ts` for the identical 404 shapes. A 404 on
  list degrades to an empty page (`{ items: [], total: 0, ... }`), same
  "let the empty state carry it" convention every other list fetcher here
  uses.
- **`data/reporting/labels.ts`** — `REPORT_TYPE_LABEL`/`_DESCRIPTION`/
  `_BADGE_VARIANT` for the four report types.
- **`data/notifications/types.ts`** — `Notification`, `NotificationType`
  (the full 10-value Prisma `notification_type` enum, read from
  `schema.prisma` directly, including `entitlement_warning`, which the
  backend doc names as a value with no live caller yet — the type still
  needs to be real since the API can return it).
- **`data/notifications/client.ts`** — `listNotifications()` (`GET
  /notifications`), `markNotificationRead()` (`POST
  /notifications/:id/read`). **One real backend-shape wrinkle reconciled
  here**: `GET /notifications` has no `channel` query param — a per-user
  notification with email delivery attempted produces TWO rows sharing the
  same `type`/`title`/`body` (one `channel: "in_app"`, one `channel:
  "email"`, per `notify()`'s own design), and the list route returns both.
  A bell showing every row would double-render every emailed
  notification, so `listNotifications` filters to `channel: "in_app"`
  client-side and recomputes its own `total`/`unreadCount` from the
  filtered set rather than trusting the server's numbers (documented
  inline as a deliberate divergence from the "never re-derive a
  server-paginated total" convention, necessary because no server-side
  filter exists for this).
- **`data/notifications/labels.ts`** — `NOTIFICATION_TYPE_LABEL`/`_ICON`.

### Hooks

- **`hooks/use-notifications.ts`** — loads once, polls `GET /notifications`
  every 30s for the life of the mounted app shell (no terminal state to
  stop on, unlike `use-agent-run.ts`'s run polling). `markRead(id)`
  optimistically flips `readAt` locally, then calls the real endpoint and
  re-syncs from the server so a failed request never leaves the UI lying.

### Components

- **`components/reports/reports-view.tsx`** — the Reports list screen
  (`PageHeader` + `Card`, exactly `OpportunitiesView`'s established shape):
  server-side `type` filter (`Select`), loading/error/empty states
  (`Skeleton`/`ErrorPanel`/`EmptyState`, never a bare `if (loading) return
  null`), row-per-report linking to `/reports/:id`, and a "Generate report"
  action wired to the dialog below.
- **`components/reports/generate-report-dialog.tsx`** — one dialog
  covering **all four** report types, not just custom: `lib/reporting/
  generate-report.ts`'s own header comment says this codebase has no live
  scheduler yet, so `POST .../generate` is today's real, directly-callable
  trigger for weekly/monthly too. Radio-card type picker with each type's
  real description; date inputs appear only for `custom` (client-side
  validated — start ≤ end, both required — mirroring the backend's Zod
  `.refine`, converted to full-day ISO datetimes since the API's
  `z.string().datetime()` rejects a bare `YYYY-MM-DD`).
- **`components/reports/report-detail-view.tsx`** — `GET /reports/:id`'s
  full immutable `content`, rendered per `reportType`
  (`baseline_comparison` vs. `weekly`/`monthly`/`custom`), with a
  "Print / Save as PDF" action using the browser's native print dialog
  (`window.print()`) rather than a fabricated download link — `pdfUrl` is
  documented as always `null` server-side (PDF export is an honest,
  undone nice-to-have). Sidebar/topbar are hidden at print time via a new
  `data-print-hide` attribute + `@media print` rule in `globals.css`
  (applied to `Sidebar`/`Topbar`) so what prints is the report content
  only, not the app chrome.
- **`components/reports/score-delta-summary.tsx`** — the baseline
  comparison's headline number (`ScoreDeltaResult`): large, signed,
  colored by direction, always labeled with which basis (GEO vs. SEO)
  produced it, with a visible caveat when `formulaVersionsMatch === false`
  — never an opaque number, per this epic's non-negotiable.
- **`components/reports/score-snapshot-panel.tsx`** — renders one
  `ScoreSnapshot` (baseline or current) with its GEO sub-components
  (mention/recommendation/position/coverage, reusing `SCORE_COMPONENT_LABEL`
  from Epic 7's `data/ai-visibility/labels.ts` so the vocabulary matches
  the AI Visibility screen exactly) and SEO technical/content split —
  "shows its work," per the epic's non-negotiable that a score is never a
  bare number.
- **`components/reports/score-deltas-list.tsx`** — a standard report's
  `scoreDeltas` (real `measurements` rows), each with its
  attribution-confidence badge always paired with its plain-language note
  (`ATTRIBUTION_CONFIDENCE_LABEL`, reused verbatim from Epic 14's `data/
  measurement/labels.ts`), never presented as more certain than the
  backend's own language.
- **`components/reports/competitor-movement-list.tsx`** — reuses Epic 8's
  `MOVEMENT_DIRECTION_LABEL`/`_BADGE_VARIANT` (`data/competitive-
  intelligence/labels.ts`) verbatim, so a competitor moving up reads as a
  warning here exactly like it does on the Competitors screen.
- **`components/reports/report-opportunities-list.tsx`** — a report's
  frozen `newOpportunities`; links out to the live `/opportunities` screen
  to actually act on one rather than offering status/priority controls
  that would silently drift from what the immutable snapshot says.
- **`components/shell/notification-bell.tsx`** — the bell-icon
  notification center in the Epic 0 app shell: unread-count badge, scrollable
  list (loading/error/empty states), per-item mark-as-read (only for a
  caller's own per-user row — org-wide rows get no such control, matching
  the backend's documented "no per-user read state for an org-wide row"
  scope boundary), "mark all read", and item click navigates via
  `actionUrl` (e.g. `/reports/:id`) when present.

### Wiring

- **`components/shell/topbar.tsx`** — `NotificationBell` added next to
  `ThemeToggle`/`UserMenu`.
- **`app/(app)/reports/page.tsx`** — replaced the Epic-15 `ComingSoon` stub
  with `ReportsView`.
- **`app/(app)/reports/[id]/page.tsx`** — new, renders `ReportDetailView`.
- **`data/nav.ts`** — dropped the now-stale `epic: 15` tag on the Reports
  nav item (the field is pure documentation metadata, not read by any
  render logic — grepped to confirm before removing).
- **`app/globals.css`** — added a scoped `@media print` block
  (`[data-print-hide] { display: none }`, `.app-content { margin-left: 0 }`)
  for the report detail page's print action.

---

## Every field/enum reconciled against the real backend

| Frontend type/value | Backend source (file:line read directly) |
|---|---|
| `ReportType` (`weekly\|monthly\|custom\|baseline_comparison`) | `routes/reports.ts`'s `REPORT_TYPES` Zod enum |
| `ReportSummary`/`Report` fields (`periodStart`, `periodEnd`, `generatedAt`, `pdfUrl` ← `file_path`, etc.) | `lib/reporting/serialize.ts`'s `serializeReport`/`serializeReportSummary` |
| `StandardReportContent`/`BaselineComparisonContent` shape | `lib/reporting/generate-report.ts`'s `ReportContent` union, `buildContent` |
| `scoreDeltas: Measurement[]` (NOT a score-over-time series) | `lib/reporting/sections.ts`'s `getScoreDeltas` (queries `measurements`, not `ai_runs`) |
| `CompetitorMovementEntry` (`MovementResult` + `competitorId`/`competitorName`) | `lib/reporting/sections.ts`'s `getCompetitorMovements`, reusing `lib/ai-visibility/competitive.ts`'s `computeCompetitorMovement`/`MovementResult` |
| `ScoreDeltaResult` (`delta`/`basis`/`formulaVersionsMatch`) | `lib/measurement/scoring.ts`'s `ScoreDeltaResult`/`computeScoreDelta` |
| `GenerateReportInput` (`periodStart`/`periodEnd` required together, `custom` only) | `routes/reports.ts`'s `generateBodySchema` `.refine` |
| `NotificationType` (10 values incl. `weekly_digest`/`entitlement_warning`) | `packages/database/prisma/schema.prisma`'s `enum notification_type` |
| `Notification` fields | `lib/notifications/serialize.ts`'s `serializeNotification` |
| `GET /notifications` has no `channel` filter; per-user notifications can appear twice (`in_app` + `email`) | `routes/notifications.ts`'s `where` clause (no `channel` in it) + `lib/notifications/notify.ts`'s "one row per channel attempted" design |
| Mark-read is restricted to the caller's own per-user row | `routes/notifications.ts`'s `POST /:id/read` handler (`where: { user_id: user.id }`) |
| Base paths (`/brands/me/reports`, `/reports/:id`, `/notifications`) | `apps/api/src/app.ts`'s route-mounting section |

---

## `pnpm --filter @bebest/web` results

- **`typecheck`** (`tsc --noEmit`) — clean, 0 errors.
- **`lint`** (`eslint .`) — clean, 0 errors, 0 warnings (one
  `react/no-unescaped-entities` was caught and fixed during the build:
  an apostrophe in `generate-report-dialog.tsx`'s dialog description).
- **`build`** (`next build`, Turbopack) — succeeds. `/reports` and
  `/reports/[id]` both appear in the route manifest (`/reports` static,
  `/reports/[id]` dynamic per-id, same ƒ/○ split every other detail route
  in this app uses).

---

## Honest gaps / scope boundaries

1. **No real PDF export** — `pdfUrl` is always `null` (documented backend
   gap). The detail page's "Print / Save as PDF" uses the browser's native
   print dialog instead of a fabricated download link; this is a
   real, working substitute for "share with your board," not a stub, but
   it is not a server-generated PDF file.
2. **No live scheduler** — `generate-report-dialog.tsx` is the real,
   user-facing trigger for weekly/monthly/baseline_comparison, same as
   custom, because the backend has none either (`POST .../generate` is
   today's only mechanism for all four types). A weekly digest is not
   generated automatically; a user (or a future cron) must trigger it.
3. **`GET /notifications` pagination is not fully accurate for the bell** —
   because the route has no `channel` filter, `listNotifications` fetches
   one page (`limit=50`) and filters/recomputes client-side rather than
   paging through the server's total. A user with more than 50 combined
   in-app+email notification rows could have older in-app notifications
   fall off the fetched page before they're filtered in. Not expected to
   matter in practice (in-app rows are the majority; email rows only exist
   for per-user notifications with a resolvable email), but named here
   rather than silently assumed away.
4. **Org-wide notifications are never markable read** — matches the
   backend's own documented scope boundary (no per-user read-state column
   for an org-wide row); the bell simply omits the mark-read control for
   those rows rather than inventing a workaround.
5. **`entitlement_warning` has a real label/icon in the frontend** (so the
   bell renders correctly if the API ever returns one) but, per the
   backend doc, nothing server-side ever produces one yet — this is
   forward-compatible dead code, not a built feature.
6. **`report.createdBy` is not resolved to a user name** — no user-directory
   lookup endpoint was in scope to build against; the detail page shows
   "Generated `<relative time>`" without an author name rather than
   guessing at one.

---

## Handoff

Ready for `qa-tester` full-flow verification: generate each of the four
report types from `/reports`, confirm the detail view renders the correct
section set per type, confirm a `baseline_comparison` report generated
before an AI run completes shows the "no score data yet" state rather than
erroring, confirm the notification bell shows a `report_ready`/
`weekly_digest` notification after generating (backend's `notify()` call
in `routes/reports.ts`'s `POST /generate`), and confirm mark-as-read
persists across a reload (not just the optimistic local flip).
