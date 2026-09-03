# @bebest/web — decisions vs. the original implementation

## Session/token handling (Epic 0 follow-up — see `platform/docs/epics/00-session-token-wiring-fix.md`)

### The bug this fixes

`lib/api-client.ts` was written against an assumption that was never true of
`apps/api`: that the backend sets an httpOnly cookie and the frontend just
needs to `credentials: "include"` and otherwise leave auth alone. The real
backend (`apps/api/src/routes/auth.ts`, `apps/api/src/lib/jwt.ts`) is
bearer-token-only — a 15-minute RS256 access token and a 7-day rotating
refresh token, returned in the JSON body of `/auth/magic-link/verify`,
`/auth/refresh`, and `/auth/select-org`. It sets **no cookies at all**. Every
epic that called `apiClient` against the real deployed API would have sent
no `Authorization` header and been rejected as unauthenticated on every
single call — this was invisible to every epic's own verification because
none of them had a live, logged-in session to test against.

### Where the tokens live

- **Access token — in-memory only** (`lib/auth-state.ts`, a module-level
  `let`). Never written to `localStorage`, `sessionStorage`, or a cookie.
  **Why:** an access token is exactly the kind of bearer credential an XSS
  bug on this origin would go looking for in storage, because storage
  persists and a script can read it at leisure; a variable that only exists
  in the page's current JS heap doesn't survive a `postMessage` back to the
  attacker's server unless the attacker's payload runs *while that tab is
  open*, and even then only gets a token that is already capped at 15
  minutes of usefulness. Keeping it in memory doesn't make XSS harmless —
  nothing about client-side storage does — but it shrinks the blast radius
  from "any future XSS bug leaks a credential that's valid until explicitly
  revoked" to "any future XSS bug can act as the user for up to the current
  access token's remaining lifetime, in that tab, while it's open." The
  cost: every full page reload starts with no access token, so the first
  authenticated request after a reload always takes the 401 → refresh →
  retry path once (see below) before succeeding.

- **Refresh token — `localStorage`.** This is the real tradeoff, made
  explicitly rather than by default:

  **Why not keep it in memory too (log the user out on every reload)?**
  That's the maximally-safe option — a refresh token that only lives in JS
  memory can't be read out of storage by an XSS payload that runs after the
  fact, only by one running live in the same tab. But the backend gives us
  no cookie to fall back on for "survive a reload without touching
  JS-readable storage," and the product requirement here is explicit: the
  session has to survive a reload/new tab. Logging every user out on every
  refresh, with a 12+-epic app that includes long CRM/reporting workflows
  people reload or bookmark mid-task, is a real usability cost, not a minor
  one — it was rejected on that basis, not overlooked.

  **Why not an httpOnly cookie instead?** That's the actually-correct answer
  for "persist a credential the JS layer never needs to touch," and it's
  exactly what `api-client.ts`'s old (wrong) comment assumed already
  existed. It doesn't, and adding it is a **backend** change (the auth
  routes would need to set/read a cookie, handle `SameSite`/`Secure`
  attributes, and — since cookies reintroduce CSRF exposure that bearer
  tokens don't have — the "no CSRF tokens" decision in `apps/api/
  DECISIONS.md` would need to be revisited). This task's brief is explicit
  that backend routes are out of scope unless a genuine bug is found; this
  isn't a bug, it's a legitimate architecture the backend committed to
  (RS256 bearer tokens, ADR-level decision recorded in that file). Redoing
  it here would be a backend redesign disguised as a frontend fix. If a
  later epic revisits this, moving the refresh token into an httpOnly
  cookie is the recommended next step and this file's `localStorage` choice
  should be treated as superseded the day that lands.

  **Mitigating factors that make `localStorage` a defensible choice given
  the constraint above, not just the least-bad one:**
  - Refresh tokens **rotate on every use** (`apps/api/src/routes/auth.ts`'s
    `/refresh` — the old token is revoked in the same transaction the new
    one is issued) and are stored server-side as a **hash**, never raw
    (`jwt.ts`'s `generateRefreshToken`/`hashToken`). A stolen refresh token
    is useful to an attacker only until the legitimate client's next
    refresh call, at which point the stolen copy is revoked and the theft
    becomes visible as a second `/refresh` racing the first (a reuse-
    detection signal a future epic could act on — not implemented yet,
    noted as a gap below).
  - Refresh is tied to a `sessions` row, so a compromised session can be
    revoked server-side (logout does this today; a "sign out this device"
    /"sign out everywhere" feature is additive on top of the same
    mechanism, not a rework).
  - The access token — the credential actually attached to every data
    request — is never in this exposure category at all, by the in-memory
    decision above. `localStorage` exposure of the refresh token bounds the
    damage to "can mint new access tokens for up to 7 days unless the
    session is revoked," not "can read the current session's live
    capability directly."

  **What this does NOT protect against:** if this origin has an XSS bug,
  `localStorage` is readable by that injected script, full stop — no
  storage mechanism reachable from JS is safe from JS running on the same
  origin. This decision only removes the *access* token from that
  category; it does not and cannot remove the refresh token from it while
  the backend has no cookie-based alternative to offer. That is the actual
  tradeoff being made here, stated plainly rather than left implicit.

### Refresh-on-401 (`lib/api-client.ts`)

Every `apiClient` call attaches `Authorization: Bearer <access token>` from
`auth-state.ts`. On a `401`, `api-client.ts` makes one `POST /auth/refresh`
call using the stored refresh token and, if it succeeds, stores the rotated
pair and retries the original request exactly once before giving up.
Concurrent requests that all hit `401` at once (e.g. a page that fires
several `apiClient` calls in parallel right as the access token expires)
share a single in-flight refresh via a module-level promise
(`refreshAccessTokenOnce`) rather than each independently calling
`/auth/refresh` — the backend would happily rotate the token multiple times
in that race, and every request but the last to arrive would then be
retrying with an already-revoked refresh token.

If the refresh call itself fails (refresh token missing, expired, or
revoked — including because the rotation race above already consumed it
some other way), `handleSessionExpired()` clears both tokens and redirects
to `/login`. There is no route-guard middleware in this app yet (every
route is reachable regardless of session state — a pre-existing gap, not
introduced by this change) so this redirect-on-refresh-failure is the only
thing standing in for one today; a real `middleware.ts` checking
`hasStoredSession()` before rendering `(app)` routes is the natural next
step and was left out of this pass as out of scope (this task is about
correct token *handling*, not building route protection from scratch).

### Cross-tab behavior

`auth-state.ts` listens for the `storage` event on the refresh-token key. If
one tab logs out (or has its session killed by a failed refresh), every
other open tab notices on its next render cycle and clears its own
in-memory access token + redirects to `/login` too, instead of continuing
to act as a signed-in user with a token whose backing session no longer
exists anywhere.

### Known gaps this pass didn't close (explicitly out of scope, not missed)

- **No refresh-token-reuse detection.** The backend revokes the old token
  the moment a new one is issued, but nothing currently distinguishes "the
  legitimate client refreshed" from "an attacker replayed a stolen token
  and the legitimate client's next refresh then failed as revoked." That's
  a backend-side detection feature (flag the session, force full re-auth),
  not a frontend one.
- **No proactive silent refresh on load.** The first authenticated request
  after a reload takes the 401→refresh→retry path reactively rather than
  the app refreshing preemptively on mount. This app has no app-wide
  session/user provider yet (every screen still reads `currentUser`/
  `currentOrganization` from `src/data/fixtures.ts` for *display* purposes,
  even on screens whose *data* calls are fully real — see e.g.
  `org-switcher.tsx`'s own doc comment). Proactive refresh belongs on that
  provider once it exists; bolting it onto `api-client.ts` directly would
  mean every consumer of this module pays for a `useEffect`-shaped concern
  that only makes sense once there's a component tree root to hang it from.
- **No route-guard middleware** — see the refresh-on-401 section above.
