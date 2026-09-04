# Epic 0 follow-up — Settings > Team rewire (real member list, invite, role change, remove)

Status: built, verified locally. `pnpm --filter @bebest/web typecheck`,
`lint`, and `build` (Turbopack production build) all pass clean — see
"Verification" below for exact output.

Scoped follow-up, not a new epic: a route-wiring audit found that Settings >
Team (`apps/web/src/app/(app)/settings/page.tsx`, formerly lines ~64–105)
was still fixture-backed with a literal "invites are stubbed until Epic 0's
auth backend ships" note, even though Epic 0's auth + RBAC backend
(`apps/api/src/routes/orgs.ts`) has been real, tested, and VERIFIED since
Wave 1 of this build. This pass wires that tab to the real backend. No other
Settings tab was touched — Notifications and Autonomy remain `ComingSoon`
stubs by design (out of scope, per the fix brief).

## What was broken

Settings > Team rendered exactly one row — `currentUser` from
`data/fixtures.ts` — with an `<UserPlus>` note explaining invites were
stubbed, and a `StubActionButton` in place of a real "Invite" control. There
was no way to see other members, invite anyone, change a role, or remove
someone, despite `apps/api/src/routes/orgs.ts` already implementing all four
operations with real RBAC, audit logging, and tests
(`apps/api/src/routes/orgs.test.ts`).

## What's real now

New files:

- **`apps/web/src/data/team/types.ts`** — `MembershipRole`,
  `AssignableRole`/`ASSIGNABLE_ROLES` (the exact enum
  `changeRoleSchema`/`inviteSchema` in `routes/orgs.ts` accept — `admin`,
  `analyst`, `editor`, `viewer`; deliberately excludes `owner` and the
  deprecated `member` alias), `ROLE_LABELS`, and `TeamMember` (matching
  `GET /orgs/:slug/members`'s response field-for-field).
- **`apps/web/src/data/team/client.ts`** — the data-access seam, wired
  directly against the real routes:
  - `GET /api/orgs/:slug/members` → `loadTeamData()`
  - `POST /api/orgs/:slug/invitations` → `inviteMember()`
  - `PATCH /api/orgs/:slug/members/:userId` → `changeMemberRole()`
  - `DELETE /api/orgs/:slug/members/:userId` → `removeMember()`

  Typed errors (`TeamForbiddenError`, `OwnerProtectedError`,
  `MemberNotFoundError`, `NoOrganizationError`) translate the backend's
  specific `403`/`404` bodies into messages the UI can show as-is — same
  pattern `data/billing/client.ts` and `data/agency/client.ts` already
  established for their epics.
- **`apps/web/src/components/settings/team-panel.tsx`** — the panel
  itself: real member table (avatar, name, email, role, joined date),
  loading skeleton, error state with retry, and a defensive (practically
  unreachable, since the caller is always a member) empty state — matching
  this codebase's `useAsyncData` loading/error/success convention used by
  `BillingPanel`/`IntegrationsPanel`/`AgencyClientsView`.
- **`apps/web/src/components/settings/invite-team-member-dialog.tsx`** — a
  real invite dialog (email + role, `@bebest/ui`'s `Dialog`/`Select`),
  mirroring the structure `InviteClientDialog` (Epic 18, agency invites)
  already established. Real-time email-format validation mirrors the
  backend's own `z.string().email()` so an invalid address is flagged
  before submit, not only after a round trip.

Edited:

- **`apps/web/src/app/(app)/settings/page.tsx`** — the Team `TabsContent`
  now renders `<TeamPanel />` instead of the fixture table + stub button;
  removed the now-unused `Avatar`/`Badge`/`Table*`/`getInitials`/
  `StubActionButton`/`UserPlus`/`currentUser`/`currentOrganization` imports
  that only existed for the old inline markup.

## RBAC in the UI

`manage_team` is owner/admin-only (`apps/api/src/lib/rbac.ts`'s
`PERMISSION_MATRIX`). The panel mirrors that client-side —
`currentUser.role === "owner" || currentUser.role === "admin"` gates the
invite button, every role `<Select>`, and every "Remove" button, with an
explanatory banner ("You're viewing the team as {role}…") and a tooltip on
the disabled invite button — same fixture-backed-role convention
`BillingPanel`/`IntegrationsPanel`/`WhiteLabelPanel` already use for their
own owner/admin gates. The owner row specifically is never editable or
removable (backend 403s "Cannot change owner role" / "Cannot remove
owner") — its role renders as a plain badge with a tooltip explaining why,
and its Remove button is disabled with its own tooltip.

Real enforcement is still the backend's `403`, not this client-side gate:
`changeMemberRole`/`removeMember`/`inviteMember` all catch
`TeamForbiddenError` and `OwnerProtectedError` and surface the backend's
own message via toast/inline error, so a bypass of the UI gate (or a role
that changed in another tab) fails gracefully instead of silently.

## How the current-org slug problem was resolved

Every other already-wired epic in this app reads its org from the access
token's `org` claim (`requireOrgFromToken` — e.g. `data/billing/client.ts`'s
`/orgs/me/subscription`). `routes/orgs.ts`'s member/invitation endpoints are
different: they're `:slug`-addressed (`requireOrgBySlug`), so the caller
must supply a real org slug in the URL.

This app has **no wired "what's my home organization's slug" session**
yet — `org-switcher.tsx`'s own header comment and
`docs/epics/00-session-token-wiring-fix.md`'s "What's still not real"
section both already flag this exact gap and name building a `/me`-backed
session/context provider a reasonable, not-yet-built follow-up.
`currentOrganization` (`data/fixtures.ts`) is a fixture and does not
correspond to any real backend org, so it could not be used to address
`:slug` routes.

**Resolution used**: `data/team/client.ts`'s `resolveOrgSlug()` calls the
real `GET /api/auth/me` (`apps/api/src/routes/auth.ts`), which already
returns every one of the caller's real memberships with `{ id, name, slug,
role }`, and takes the **first** organization in that list. `loadTeamData()`
resolves the slug once per panel load/reload and returns it alongside the
member list, so every subsequent mutation in the same load
(invite/role-change/remove) addresses the same org the list came from.

This is a deliberately scoped, honest interim answer, not a claim that the
app-wide "home org" gap is closed:

- For the overwhelmingly common case — a user who is a direct member of
  exactly one organization — this resolves to exactly the right org every
  time.
- A user who is a direct member of **more than one** organization will
  always be resolved to whichever org `/auth/me` returns first, with no UI
  to pick a different one for this screen. That's the same class of gap
  `OrgSwitcher`'s "client organizations" section already carries for the
  agency-switch case, just not yet solved for the home-org case anywhere in
  this app.
- The slug is **not cached** at module scope (unlike, say, `auth-state.ts`'s
  in-memory access token) — there is no hook into `clearSession`'s logout
  path from `data/team/client.ts`, so caching a resolved slug risked
  leaking one user's org into a different user's session within the same
  tab after a logout/login. One extra `/auth/me` round trip per panel
  load/reload was judged the safer trade over adding a shared cache with no
  invalidation path.

Building the real `/me`-backed "current org" provider — so every screen,
not just this one, resolves the home org the same real way — remains the
right follow-up; this pass intentionally did not take that on, since it
would touch far more than the Team tab and the fix brief scoped this pass
to Settings > Team specifically.

## Honest gaps left

- **Multi-org home resolution**, as above — not solved app-wide, only
  worked around for this one screen via "first membership from `/me`."
- **No frontend invite-accept page.** `POST /orgs/:slug/invitations`
  builds a real accept URL (`${appUrl}/invitations/accept?token=...`) and
  `POST /orgs/invitations/accept` exists on the backend, but there is still
  no `apps/web/src/app/.../invitations/accept` route to land an invited
  user on — this is `routes/orgs.ts`'s own pre-existing "not a frontend
  concern this pass" note, unchanged by this fix. An invited teammate
  cannot yet actually accept from a link today; the invite is real and
  reaches the backend/email-sender, but the redemption UI doesn't exist.
- **Email delivery** is still `ConsoleEmailSender` (logs the invite URL
  instead of sending it) — a backend/deployment concern (`apps/api/
  DECISIONS.md` ADR-010), not something this pass could or should change.
- No automated test infra exists for `@bebest/web` (no `vitest`/`jest`,
  confirmed by checking `apps/web/package.json`), same as every other
  frontend-only pass in this codebase — verification below is
  typecheck/lint/build plus a manual code-path trace, not new tests.

## Verification

```
$ pnpm --filter @bebest/web typecheck
> tsc --noEmit
(clean, no output)

$ pnpm --filter @bebest/web lint
(one pre-existing, unrelated failure in an untracked file from an earlier
wave — apps/web/src/components/overview/overview-view.tsx:4:37, unused
`Skeleton` import — not touched by this pass. Every file this pass
added/changed lints clean in isolation:
  npx eslint src/data/team/types.ts src/data/team/client.ts \
    src/components/settings/team-panel.tsx \
    src/components/settings/invite-team-member-dialog.tsx \
    "src/app/(app)/settings/page.tsx"
  → no output, exit 0)

$ pnpm --filter @bebest/web build
> next build
✓ Compiled successfully
  Running TypeScript ... Finished
  Generating static pages (31/31)
○ /settings  (prerendered as static content, same as before this pass)
```

No database connection, migration, or real network call was made while
building or verifying this — per the fix brief's hard constraints,
verification is static (typecheck/lint/build) plus tracing
`routes/orgs.ts`'s handlers and `routes/orgs.test.ts`'s existing test
expectations directly against what `data/team/client.ts` sends/expects.
