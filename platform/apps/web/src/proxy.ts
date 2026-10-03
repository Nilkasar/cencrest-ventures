import { NextResponse, type NextRequest } from "next/server";

/**
 * Sign-in guard (Epic 22 Phase 0) — an OPTIMISTIC, UX-only check.
 *
 * Tokens live in memory + localStorage (`lib/auth-state.ts`), which a proxy
 * can't read, so the only signal here is the non-sensitive `bb_session=1`
 * presence cookie the client sets on login/refresh and clears on logout or
 * refresh failure. It is not a credential: a forged cookie only renders a
 * shell whose every API call still 401s. The API (bearer tokens verified on
 * every request, `/api/platform/*` re-checking `platform_role` in the DB)
 * is the real security boundary. What this buys is that a signed-out
 * visitor never sees the app shell flash before being bounced.
 *
 * Kept literal (not imported from `auth-state.ts`) so the proxy bundle stays
 * free of client-only modules.
 */
const SESSION_PRESENCE_COOKIE = "bb_session";

/** Reachable without a session. Everything else the matcher lets through is
 *  an app route (the `(app)`, `(platform)` and `(onboarding)` groups — the
 *  onboarding wizard is only ever entered right after sign-in). */
const PUBLIC_PREFIXES = ["/login", "/auth", "/snapshot"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (request.cookies.get(SESSION_PRESENCE_COOKIE)?.value === "1") return NextResponse.next();

  const login = new URL("/login", request.nextUrl);
  // `/` just redirects to /overview; don't carry it as a destination.
  const next = pathname === "/" ? "/overview" : `${pathname}${search}`;
  login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals and any file with an extension (public/ assets,
  // icons, manifest) — those must load on the login page itself.
  matcher: ["/((?!_next/static|_next/image|_next/data|api/|.*\\..*).*)"],
};
