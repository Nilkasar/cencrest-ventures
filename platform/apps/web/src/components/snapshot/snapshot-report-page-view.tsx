"use client";

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
  const state = useSnapshotReport(token);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
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
