"use client";

import { RouteError } from "@/components/patterns/route-error";

/** Epic 19, UI item 1 — covers the onboarding wizard (industry, brand
 *  basics, claims, competitors, use-cases, done). Every step already
 *  persists on its own "Continue" (`(onboarding)/layout.tsx`'s own header
 *  comment), so a crash here genuinely doesn't lose anything — the copy
 *  says so rather than leaving a visitor to guess. */
export default function OnboardingSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      title="This step hit a snag"
      description="Nothing you've entered so far is lost — every step saves as you go. Try again, or exit and pick up where you left off later."
      homeHref="/overview"
      homeLabel="Exit onboarding"
    />
  );
}
