"use client";

import { RouteError } from "@/components/patterns/route-error";

/** Epic 19, UI item 1 — covers `/login`, `/login/check-email`, and the
 *  magic-link verify screen; no error boundary existed for the sign-in
 *  flow before this epic. */
export default function AuthSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      title="Couldn't sign you in"
      description="Something went wrong on this screen. Try again, or start over from the sign-in page."
      homeHref="/login"
      homeLabel="Back to sign in"
    />
  );
}
