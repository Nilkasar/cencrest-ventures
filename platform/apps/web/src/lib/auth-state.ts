/**
 * Session/token state for `apps/api`'s actual auth design: bearer-token
 * only, no cookies set by the server at all (see `apps/api/src/routes/
 * auth.ts` and `apps/api/DECISIONS.md`). There is no httpOnly-cookie-backed
 * session to read from — every previous epic's frontend code that assumed
 * one (see `api-client.ts`'s old header comment) was wrong. This module is
 * the one place that owns token storage; nothing else should read/write
 * either token directly.
 *
 * Storage split (full reasoning in `platform/apps/web/DECISIONS.md`):
 *   - Access token: a plain module-level variable. Lost on every reload —
 *     that's deliberate. It is never written to `localStorage`/
 *     `sessionStorage`/a cookie, so a script-injection (XSS) bug on this
 *     origin cannot read a persisted access token; the worst it can do is
 *     use the 15-minute token already in memory for as long as the tab
 *     stays open, same as it could ride any other in-page credential.
 *   - Refresh token: `localStorage`, because the product needs a session to
 *     survive a reload/new tab and the backend gives us no cookie to lean
 *     on instead. This is a real tradeoff, not a default — see DECISIONS.md.
 */

const REFRESH_TOKEN_STORAGE_KEY = "bebest.auth.refreshToken.v1";
/**
 * Which organization this browser was last acting as.
 *
 * Needed because the org lives ONLY on the access token, which is
 * deliberately memory-only — so every reload started org-less, and every
 * org-scoped route answered 409 "No organization selected" until something
 * called `/select-org` again. Nothing did. Persisting the slug lets the
 * refresh call re-attach it (`POST /auth/refresh { orgSlug }`), where the
 * server re-verifies membership from the database. A slug is not a
 * credential: storing it grants nothing on its own.
 */
const ORG_SLUG_STORAGE_KEY = "bebest.auth.orgSlug.v1";

let accessToken: string | null = null;

/**
 * Presence cookie for `src/proxy.ts`'s sign-in redirect — UX ONLY, NOT a
 * credential. The proxy runs before any page JS and cannot see
 * `localStorage`, so without this a signed-out visitor to an app route got
 * the whole shell rendered until the first API call 401'd. The value is a
 * constant `1`: it carries no identity and grants nothing — forging it only
 * gets you the shell of a page whose every API call still 401s. The API
 * (bearer tokens, re-verified per request) remains the real security
 * boundary. Set whenever a session is established or rotated (login,
 * `/auth/refresh`), cleared on logout and on refresh failure. Lifetime
 * mirrors the API's refresh-token TTL (7 days, `apps/api/src/lib/jwt.ts`).
 */
export const SESSION_PRESENCE_COOKIE = "bb_session";
const SESSION_PRESENCE_MAX_AGE_S = 7 * 24 * 60 * 60;

function writePresenceCookie(present: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = present
    ? `${SESSION_PRESENCE_COOKIE}=1; Path=/; Max-Age=${SESSION_PRESENCE_MAX_AGE_S}; SameSite=Lax${secure}`
    : `${SESSION_PRESENCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/** Re-asserts the presence cookie for a session already on disk (a browser
 *  that signed in before the cookie existed, or whose cookie expired while
 *  the refresh token is still valid). */
export function markSessionPresent(): void {
  writePresenceCookie(true);
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setRefreshToken(token: string | null): void {
  if (!hasLocalStorage()) return;
  try {
    if (token) {
      window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage full/blocked (private browsing, quota) — the user just stays
    // logged in for this tab only, no reload persistence. Not worth
    // failing the login/refresh call over.
  }
}

/** Called once at successful login (`/auth/magic-link/verify`) and again on
 *  every `/auth/refresh` (which rotates the refresh token — the old one is
 *  revoked server-side the moment the new one is issued, so both must be
 *  updated together). */
export function setSession(tokens: { accessToken: string; refreshToken: string }): void {
  setAccessToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
  writePresenceCookie(true);
}

/** `/auth/select-org` mints a new org-scoped access token but does NOT
 *  rotate the refresh token — the session lineage is unchanged, only which
 *  org the access token is scoped to. Pass the slug so the choice survives
 *  a reload (see `ORG_SLUG_STORAGE_KEY`). */
export function setOrgScopedAccessToken(token: string, slug?: string): void {
  setAccessToken(token);
  if (slug) setSelectedOrgSlug(slug);
}

/** The org this browser last acted as, or null. */
export function getSelectedOrgSlug(): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(ORG_SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedOrgSlug(slug: string | null): void {
  if (!hasLocalStorage()) return;
  try {
    if (slug) window.localStorage.setItem(ORG_SLUG_STORAGE_KEY, slug);
    else window.localStorage.removeItem(ORG_SLUG_STORAGE_KEY);
  } catch {
    // Same "storage blocked" tolerance as the refresh token below — the
    // user keeps working, they just re-select an org after a reload.
  }
}

/**
 * The `org` claim of the in-memory access token — the organization the API
 * scopes the next request to. Decoded WITHOUT verification: a read of our
 * own token for display/routing only; the server re-verifies the signature
 * and the membership behind the claim on every request.
 */
export function getAccessTokenOrgId(): string | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { org?: unknown };
    return typeof claims.org === "string" ? claims.org : null;
  } catch {
    return null;
  }
}

/** True if a refresh token is on disk — i.e. "was logged in on this
 *  browser," even though `accessToken` is always null immediately after a
 *  reload. Doesn't guarantee the refresh token is still valid server-side
 *  (revoked/expired) — only a real `/auth/refresh` call can confirm that. */
export function hasStoredSession(): boolean {
  return getRefreshToken() !== null;
}

/** Clears both tokens and current org slug. Safe to call even if nothing was ever set. */
export function clearSession(): void {
  setAccessToken(null);
  setRefreshToken(null);
  setSelectedOrgSlug(null);
  writePresenceCookie(false);
}

const SAME_ORIGIN_BASE = "http://same-origin.invalid";

/**
 * Where to send the user after sign-in. Only same-origin relative paths are
 * accepted ("/x" — never "//host", "/\host" or "https://…"), so `?next=`
 * can never become an open redirect. Returns null for anything else.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  try {
    const url = new URL(raw, SAME_ORIGIN_BASE);
    if (url.origin !== SAME_ORIGIN_BASE) return null;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/") || url.pathname.startsWith("/auth/")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * `?next=` has to survive the trip through the user's inbox (the magic link
 * is often opened in a new tab) or Google's consent screen, so it's parked
 * here when sign-in starts and consumed once by the page that completes it —
 * re-validated on the way out.
 */
const NEXT_PATH_STORAGE_KEY = "bebest.auth.next.v1";

export function rememberPostLoginPath(raw: string | null | undefined): void {
  if (!hasLocalStorage()) return;
  const next = safeNextPath(raw);
  try {
    if (next) window.localStorage.setItem(NEXT_PATH_STORAGE_KEY, next);
    else window.localStorage.removeItem(NEXT_PATH_STORAGE_KEY);
  } catch {
    // Storage blocked — the user just lands on the default page.
  }
}

export function consumePostLoginPath(): string | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(NEXT_PATH_STORAGE_KEY);
    window.localStorage.removeItem(NEXT_PATH_STORAGE_KEY);
    return safeNextPath(raw);
  } catch {
    return null;
  }
}

/** `/login`, carrying the page to return to after sign-in. */
export function loginUrlFor(path: string | null): string {
  const next = safeNextPath(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

const AUTH_PAGE_PREFIXES = ["/login", "/auth/"];

function isOnAuthPage(): boolean {
  if (typeof window === "undefined") return false;
  return AUTH_PAGE_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix));
}

/** Called when a refresh attempt fails (refresh token missing, expired, or
 *  revoked) while retrying a 401 — i.e. the session is truly over, not just
 *  the access token expiring normally. Clears local state — including the
 *  presence cookie, so `proxy.ts` treats this browser as signed out from
 *  the next navigation on — and sends the user to `/login?next=<here>`.
 *  Guarded against
 *  redirect loops on pages that never had a session to lose in the first
 *  place (login/verify themselves never reach this path — see
 *  `api-client.ts`). */
export function handleSessionExpired(): void {
  clearSession();
  if (typeof window !== "undefined" && !isOnAuthPage()) {
    // A plain module, not a component — there's no `useRouter()`/`redirect()`
    // to reach for here, this fires from `api-client.ts`'s fetch layer.
    window.location.href = loginUrlFor(currentPath());
  }
}

if (hasLocalStorage()) {
  // Cross-tab logout: if another tab clears the refresh token (explicit
  // logout, or its own `handleSessionExpired`), this tab's in-memory access
  // token is now orphaned — drop it and send this tab to `/login` too,
  // instead of letting it keep making requests with a token whose session
  // the user (or the server) just ended elsewhere.
  window.addEventListener("storage", (event) => {
    if (event.key === REFRESH_TOKEN_STORAGE_KEY && event.newValue === null) {
      setAccessToken(null);
      if (!isOnAuthPage()) window.location.href = loginUrlFor(currentPath());
    }
  });
}
