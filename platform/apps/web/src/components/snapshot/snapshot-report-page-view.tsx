"use client";

import Link from "next/link";
import { AlertTriangle, Link2Off } from "lucide-react";
import { EmptyState } from "@bebest/ui";
import { useSnapshotReport } from "@/hooks/use-snapshot-report";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { SnapshotPreparingPanel, SnapshotReportSkeleton } from "./snapshot-preparing-panel";
import { SnapshotReportView } from "./snapshot-report-view";

/**
 * Client half of the public report route — polls `GET /snapshot/:token`
 * (`useSnapshotReport`) and renders whichever of its five states comes
 * back. Kept separate from `page.tsx` so that file can stay a plain async
 * server component awaiting Next's `params` promise, matching every other
 * dynamic route in this app.
 */
export function SnapshotReportPageView({ token }: { token: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/snapshot" className="flex items-center gap-2 rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="size-7 object-contain" />
            <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">BeBest</span>
          </Link>
          <Link
            href="/login"
            className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 sm:py-16">
        <ReportBody token={token} />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-4xl px-6 py-8 text-[12px] text-subtle-foreground">
          BeBest measures how AI models and search engines see your brand.
        </div>
      </footer>
    </div>
  );
}

function ReportBody({ token }: { token: string }) {
  const state = useSnapshotReport(token);

  return (
    <div>
      {state.status === "loading" && <SnapshotReportSkeleton />}

      {state.status === "preparing" && <SnapshotPreparingPanel message={state.message} />}

      {state.status === "not-found" && (
        <EmptyState
          icon={<Link2Off size={20} />}
          title="This snapshot link isn't valid"
          description="It may be mistyped, or the snapshot may have expired. Request a new one from the snapshot form."
        />
      )}

      {state.status === "failed" && (
        <div className="flex flex-col items-center text-center gap-3 rounded-xl border border-danger/30 bg-danger-muted px-8 py-14">
          <AlertTriangle size={28} className="text-danger" aria-hidden="true" />
          <p className="font-display text-[17px] font-semibold text-foreground">{state.message}</p>
        </div>
      )}

      {state.status === "error" && (
        <ErrorPanel message={state.error.message} onRetry={() => window.location.reload()} />
      )}

      {state.status === "ready" && <SnapshotReportView report={state.report} />}
    </div>
  );
}
