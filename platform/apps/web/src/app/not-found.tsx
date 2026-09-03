import { RouteNotFound } from "@/components/patterns/route-not-found";

/** Root fallback for any URL that doesn't resolve inside any route group —
 *  a signed-out visitor's mistyped/stale link most often. `(app)` has its
 *  own `not-found.tsx` that keeps the authenticated shell's chrome; this
 *  one has no session context to assume, so it only offers the sign-in
 *  page. */
export default function RootNotFound() {
  return <RouteNotFound homeHref="/login" homeLabel="Go to sign in" />;
}
