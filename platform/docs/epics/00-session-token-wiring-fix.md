# Epic 0 follow-up — real session/token wiring (frontend ↔ backend auth seam)

Status: built, verified locally. `pnpm --filter @bebest/web typecheck`,
`lint`, and `build` (Turbopack production build) all pass clean — see
"Verification" below for exact output and the manual request/response trace
(no test infra exists for `@bebest/web` — see that section for why this is
a documented trace rather than automated tests).

This is cross-cutting infrastructure, not a new epic — it closes a gap that
originated in Epic 0 (`00-platform-foundation-frontend.md`'s `api-client.ts`
and stub login screen) and was only caught when Epic 18's frontend traced
the full auth chain and found nothing anywhere attached a real
`Authorization` header.

## What was broken

1. **`src/lib/api-client.ts`** sent `credentials: "include"` and no other
   auth header, on the documented assumption ("read from an httpOnly-
   cookie backed session, not localStorage") that the backend sets a
   session cookie. It doesn't — `apps/api/src/routes/auth.ts` and
   `apps/api/src/lib/jwt.ts` are bearer-token-only (15-minute RS256 access
   tokens, 7-day rotating refresh tokens, both returned in the JSON body,
   zero cookies set). Every one of the 12+ epics built on top of this
   client (CRM, brand intelligence, SEO, AI visibility, competitive
   intelligence, opportunities, recommendations, billing, agency) would
   have sent every single request unauthenticated against a real deployed
   backend.
2. **`src/app/(auth)/login/page.tsx`** was a 500ms `setTimeout` stub that
   never called any endpoint.
3. **No magic-link-verify screen existed at all** — the backend emails a
   URL (`${appUrl}/auth/magic-link/verify?token=...`) that had nowhere to
   land in this app.
4. **No token storage existed** — nothing decided where an access or
   refresh token would even live once obtained.
5. **No refresh-on-401** — with a 15-minute access token and nothing
   refreshing it, every session would have died 15 minutes after login
   regardless of activity.
6. **`components/shell/org-switcher.tsx`**'s `switchToOrg` call already hit
   the real `POST /auth/select-org` endpoint (Epic 18) but discarded the
   org-scoped access token it got back — the exact gap Epic 18's own doc
   comment flagged as a known limitation for "whichever epic wires
   `apiClient`'s auth layer."

## What was built

### `src/lib/auth-state.ts` (new)

The single module that owns both tokens:
- Access token: module-level variable, in-memory only, gone on reload by
  design.
- Refresh token: `localStorage`, because the product needs the session to
  survive a reload and the backend offers no cookie to lean on instead.
- `setSession()` (login, refresh), `setOrgScopedAccessToken()` (select-org
  — access token only, no refresh rotation), `clearSession()` (logout),
  `hasStoredSession()`, `handleSessionExpired()` (clears + redirects to
  `/login`), and a cross-tab `storage` listener so a logout in one tab
  ends the session in every open tab.

Full reasoning for the storage split, alternatives considered (memory-only
refresh token, httpOnly cookie), and what this does and doesn't protect
against: `platform/apps/web/DECISIONS.md`.

### `src/lib/api-client.ts` (rewritten)

- Attaches `Authorization: Bearer <access token>` from `auth-state.ts` on
  every request when a token is present.
- Dropped `credentials: "include"` — there are no cookies to send.
- On `401`: calls `POST /auth/refresh` once (concurrent 401s share a single
  in-flight refresh via `refreshAccessTokenOnce`, so a burst of expired
  parallel requests doesn't fire multiple competing refreshes and shoot
  itself with the backend's rotate-and-revoke-the-old-token behavior),
  stores the rotated `{ accessToken, refreshToken }` pair on success, and
  retries the original request exactly once. If refresh fails, calls
  `handleSessionExpired()`.
- Replaced the stale "httpOnly cookie" seam comment with what's actually
  implemented and where the tradeoffs are documented.
- Public API (`apiClient.get/post/patch/delete`) is unchanged — every
  existing epic's `data/*/client.ts` file needed zero changes.

### `src/app/(auth)/login/page.tsx`

Calls the real `POST /auth/magic-link` with `{ email }`, then routes to the
existing `/login/check-email` confirmation screen on success. Removed the
stale "this is a visual preview" copy.

### `src/app/(auth)/login/check-email/page.tsx`

"Resend link" now calls the same real `POST /auth/magic-link` endpoint
instead of just flipping local state.

### `src/app/(auth)/auth/magic-link/verify/page.tsx` (new)

The route is `/auth/magic-link/verify` — not `/login/verify` or anything
invented — because that's the literal path `apps/api/src/routes/auth.ts`'s
`POST /magic-link` embeds in the email URL
(`${appUrl}/auth/magic-link/verify?token=${token}`). Since `(auth)` is a
Next.js route group (parenthesized, stripped from the URL), the file lives
at `src/app/(auth)/auth/magic-link/verify/page.tsx` and resolves to exactly
that URL while still getting the `(auth)` layout's two-pane chrome.

Reads `token` from the query string, calls
`POST /auth/magic-link/verify { token }` on mount, and:
- On success: stores `{ accessToken, refreshToken }` via `setSession()`
  and redirects to `/overview` (the same landing route the root `/` page
  redirects to).
- On failure: shows a specific message for each of the backend's real
  error cases — 404/400 (bad token), 410 (expired — the backend's magic
  links are valid 15 minutes), and the used-token case — with a link back
  to `/login`.
- Guards against a double-fire (StrictMode/fast-refresh double-invoking
  the effect) with a `useRef` — the token is single-use server-side, so a
  second real call would always fail "already used" even though the first
  one succeeded.

### `src/components/shell/user-menu.tsx`

"Sign out" now calls `POST /auth/logout` with the stored refresh token
(best-effort — local state is cleared and the user is routed to `/login`
even if that call fails, since staying "logged in" client-side against a
possibly-already-revoked session helps no one), then `clearSession()`.

### `src/components/shell/org-switcher.tsx` + `src/data/agency/client.ts`

`handleSelectClient` now calls `setOrgScopedAccessToken(selection.
accessToken)` immediately after `switchToOrg` resolves, so every
subsequent `apiClient` call is scoped to the client org from that point
on. Updated both files' doc comments — `agency/client.ts`'s used to say
this was a known, unfixed gap; it isn't anymore.

## The refresh-token storage decision (short version)

Refresh token goes in `localStorage`, not memory-only and not an httpOnly
cookie. Access token stays in-memory only, never persisted anywhere.
Reasoning, alternatives considered, mitigating factors (rotation-on-use,
hashed server-side storage, session-level revocation), and what this
explicitly does NOT protect against are all in
`platform/apps/web/DECISIONS.md` — that file is the source of truth, not a
summary here.

## What's still not real

- **Actual email delivery.** `apps/api`'s `ConsoleEmailSender` logs the
  magic-link URL instead of sending it (per `apps/api/DECISIONS.md`'s
  ADR-010 note — a `ResendEmailSender` is future work, not this pass's
  scope, and not a frontend concern either way). The verify screen and its
  URL shape are real; only the transport that would carry that URL to an
  inbox is a stand-in.
- **No route-guard middleware.** Every `(app)` route is reachable
  regardless of session state today — that's a pre-existing gap this pass
  didn't introduce or was asked to close (the brief's scope is token
  handling, not access control), but it means the app has no single place
  that redirects an unauthenticated visit to `/login` other than the
  reactive "a data call 401'd" path this pass adds.
- **`currentUser`/`currentOrganization` display data is still
  fixture-backed** (`src/data/fixtures.ts`) — this pass wires the *token*
  layer end-to-end, not a `/me`-backed session/user context provider to
  replace those fixtures app-wide. `org-switcher.tsx`'s "client
  organizations" section already mixes real (`GET /agency/clients`) and
  fixture (`currentOrganization`) data for exactly this reason, predating
  this pass. Building that provider (and having it own the proactive
  "silent refresh on mount" this pass's `DECISIONS.md` flags as a natural
  next step) is a reasonable follow-up, not something this pass silently
  skipped — see `DECISIONS.md`'s "Known gaps" section.
- **No refresh-token-reuse detection** server-side (a stolen-and-replayed
  refresh token isn't distinguished from a normal rotation until the
  legitimate client's own next refresh fails) — a backend feature, out of
  this pass's scope per the brief.

## Verification

### Automated

No test infra exists for `@bebest/web` (no `vitest`/`jest` dependency, no
`*.test.*` file, no `test` script in `apps/web/package.json`) as of this
pass — confirmed by checking `apps/web/package.json` and the workspace for
any config before starting. Per the brief, this section is the "manually
trace and document" fallback instead of new tests.

```
pnpm --filter @bebest/web typecheck   # tsc --noEmit — clean
pnpm --filter @bebest/web lint        # eslint . — clean (0 errors, 0 warnings)
pnpm --filter @bebest/web build       # next build — succeeds; route list
                                       # confirms `/auth/magic-link/verify`
                                       # exists at exactly that path
```

### Manual trace: login → authenticated request → expiry → refresh → retry → logout

Citing the real code paths on both sides for each step.

**1. Login (magic-link request)**
`login/page.tsx`'s `handleSubmit` → `apiClient.post("/auth/magic-link",
{ email })` → `api-client.ts`'s `request()` sends
`POST {API_BASE_URL}/auth/magic-link` with no `Authorization` header (no
token yet) → `apps/api/src/routes/auth.ts`'s `/magic-link` handler creates
a `magic_link_tokens` row and calls `emailSender.sendMagicLink()` with URL
`${appUrl}/auth/magic-link/verify?token=<raw token>` → responds
`{ success: true }` always → frontend routes to `/login/check-email`.

**2. Verify (the link is "clicked")**
Navigating to `/auth/magic-link/verify?token=<raw token>` renders
`auth/magic-link/verify/page.tsx`, whose effect calls
`apiClient.post("/auth/magic-link/verify", { token })` → backend hashes
the token, looks it up, marks it used, creates/updates the `users` row,
calls `issueSession()` (creates a `sessions` row + a `refresh_tokens` row
+ signs a first access token with `org: null`), returns
`{ accessToken, refreshToken, user }` → frontend calls
`setSession({ accessToken, refreshToken })` (access token → the module-
level variable in `auth-state.ts`; refresh token → `localStorage` key
`bebest.auth.refreshToken.v1`) → redirects to `/overview`.

**3. An authenticated request**
Any `apiClient.get/post/patch/delete` call from any epic's `data/*/
client.ts` → `api-client.ts`'s `request()` reads `getAccessToken()`
(non-null right after step 2) → sends
`Authorization: Bearer <access token>` → `apps/api`'s `requireAuth`
middleware verifies it via `jwt.ts`'s `verifyAccessToken` (RS256, public
key) → request proceeds normally, response returned as before.

**4. Access token expires (15 minutes pass, or a page reload zeroes the
in-memory token)**
Next `apiClient` call sends either no `Authorization` header (post-reload,
`accessToken` is `null` again) or an expired one → backend's
`verifyAccessToken` throws `InvalidAccessTokenError` → `requireAuth`
responds `401`.

**5. Refresh**
`api-client.ts`'s `request()` sees `status === 401` and
`!isRetryAfterRefresh` → calls `refreshAccessTokenOnce()` → (first caller
in a burst) `refreshAccessToken()` reads `getRefreshToken()` from
`localStorage`, `POST`s `{ refreshToken }` to `/auth/refresh` directly (not
through `request()`, so this call itself can't recurse into the 401
handler) → backend hashes the incoming token, finds the `refresh_tokens`
row, checks it's not revoked/expired, checks its `sessions` row isn't
revoked, **revokes the old refresh token**, issues + stores a new one,
signs a new access token (`org: null` — the backend's own documented rough
edge: a refresh always drops org context, a client that needs it re-calls
`/select-org` after) → responds `{ accessToken, refreshToken }` → frontend
`setSession()`s the new pair.

**6. Retry**
`refreshAccessTokenOnce()` resolves `true` → `request()` calls itself again
with `isRetryAfterRefresh = true` → this second attempt reads the
newly-stored access token, succeeds, and the caller that originally issued
the request never sees the intermediate 401 at all.

**Failure branch:** if step 5's `/auth/refresh` call itself responds
non-`ok` (refresh token invalid/expired/revoked), `refreshAccessToken()`
returns `false` without storing anything → `request()` calls
`handleSessionExpired()` (clears both tokens, redirects to `/login` unless
already on an auth page) → then still throws the original `401` as an
`ApiError` to the caller (belt-and-suspenders: the redirect is already in
flight, but a caller with its own error handling — e.g. a toast — doesn't
crash on an unhandled state).

**7. Logout**
`user-menu.tsx`'s `handleSignOut` reads the current refresh token, calls
`apiClient.post("/auth/logout", { refreshToken })` (best-effort — errors
are swallowed) → backend hashes it, finds the `refresh_tokens` row,
revokes it and its `sessions` row → frontend `clearSession()`s regardless
of the call's outcome → routes to `/login`. Any other open tab notices the
`localStorage` key disappear via the `storage` event listener in
`auth-state.ts`, clears its own in-memory access token, and redirects to
`/login` too.

**8. Org switch** (`org-switcher.tsx`, Epic 18's flow)
`handleSelectClient` → `switchToOrg(slug)` → `POST /auth/select-org
{ slug }` with the current access token attached (route requires auth) →
backend checks direct membership, then `resolveAgencyAccess` → mints a new
access token with `org: <id>` set → frontend now calls
`setOrgScopedAccessToken(selection.accessToken)` before doing anything
else, so the very next `apiClient` call anywhere in the app is scoped to
that org. Refresh token is untouched (`/select-org` never rotates it — the
session lineage doesn't change, only which org the access token claims).

## Files changed

- `platform/apps/web/src/lib/auth-state.ts` — new
- `platform/apps/web/src/lib/api-client.ts` — rewritten (auth header,
  refresh-on-401, seam comment)
- `platform/apps/web/src/app/(auth)/login/page.tsx` — real magic-link
  request call
- `platform/apps/web/src/app/(auth)/login/check-email/page.tsx` — real
  resend call
- `platform/apps/web/src/app/(auth)/auth/magic-link/verify/page.tsx` — new
- `platform/apps/web/src/components/shell/user-menu.tsx` — real logout
- `platform/apps/web/src/components/shell/org-switcher.tsx` — stores the
  org-scoped access token
- `platform/apps/web/src/data/agency/client.ts` — doc comment updated (gap
  closed)
- `platform/apps/web/DECISIONS.md` — new, refresh-token storage tradeoff
- `platform/docs/epics/00-session-token-wiring-fix.md` — this file

No files under `apps/api`, `web-app/`, or the repo-root marketing site were
touched.
