"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@bebest/ui";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Next.js 16.3+'s `error.tsx` prop — re-fetches and re-renders the
   *  boundary's children in place, without a full navigation. */
  retry: () => void;
  title?: string;
  description?: string;
  /** Where "Go back" should point — omit to hide that action (used by
   *  `global-error.tsx`, which has nowhere safe to send a broken root
   *  layout back to). */
  homeHref?: string;
  homeLabel?: string;
}

/**
 * Epic 19 (Production Hardening), UI item 1 — the real fallback every
 * `error.tsx`/`global-error.tsx` in this app renders, so "a broken request
 * never produces a blank screen" is one shared, tested component instead of
 * N copy-pasted ones. Logs a structured, JSON-shaped line (the same
 * `{level, ...}` convention `apps/api`'s request logger and its new
 * `ErrorTracker` interface use server-side, per
 * `docs/epics/19-production-hardening-backend.md` item 3) — no client-side
 * tracking SDK is wired up yet; see that epic's frontend completion doc's
 * "what's not done" for the honest account of that gap. Moves focus to its
 * own heading on mount so a screen-reader user lands on the error, not
 * wherever focus happened to be when the crash occurred.
 */
export function RouteError({ error, retry, title = "Something went wrong", description, homeHref, homeLabel = "Go back" }: RouteErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "client_error_boundary",
        message: error.message,
        digest: error.digest,
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
      }),
    );
    headingRef.current?.focus();
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-full border border-danger/30 bg-danger-muted text-danger"
        aria-hidden="true"
      >
        <AlertTriangle size={20} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-[19px] font-semibold text-foreground focus-visible:outline-none"
        >
          {title}
        </h1>
        <p className="max-w-[440px] text-[13.5px] leading-relaxed text-muted-foreground">
          {description ?? "This screen hit an unexpected error. Your data is safe — try again, or head back and pick up where you left off."}
        </p>
        {error.digest && <p className="mt-1 font-mono text-[11px] text-subtle-foreground">Reference: {error.digest}</p>}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={retry}>
          Try again
        </Button>
        {homeHref && (
          <Button asChild variant="outline" size="sm">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
