import { Loader2 } from "lucide-react";
import { SkeletonText } from "@bebest/ui";

const STEPS = [
  "Crawling a sample of your site",
  "Sampling AI queries across ChatGPT, Claude, Gemini, and Perplexity",
  "Running a basic SEO pass",
  "Scoring gaps and priorities",
] as const;

/**
 * The report page's non-terminal state — `useSnapshotReport` is still
 * polling because `snapshot_requests.status` is `pending`/`processing`.
 * Shows the message the backend actually sent (never a re-typed copy of
 * it) plus a static outline of what `runFreeSnapshotPipeline` is doing
 * behind the scenes (steps 2b-2e of `docs/epics/17-free-snapshot.md`) —
 * there is no real per-step progress signal from the API for an anonymous
 * pipeline with no persisted job rows to poll (see the backend's own
 * `orchestrator.ts` header on why), so this is honestly a single spinner
 * with context, not a progress bar claiming precision the pipeline can't
 * report.
 */
export function SnapshotPreparingPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 rounded-xl border border-border bg-surface-raised px-8 py-16">
      <Loader2 size={28} className="text-accent animate-spin" aria-hidden="true" />
      <div className="flex flex-col gap-2 max-w-md">
        <p className="font-display text-[19px] font-semibold text-foreground tracking-[-0.01em]">{message}</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          This page will update automatically — no need to refresh.
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-left w-full max-w-sm">
        {STEPS.map((step) => (
          <li key={step} className="flex items-center gap-2.5 text-[12.5px] text-subtle-foreground">
            <span className="size-1.5 rounded-full bg-border-strong shrink-0" aria-hidden="true" />
            {step}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SnapshotReportSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-surface-raised p-6">
        <SkeletonText lines={2} lastLineWidth="40%" />
      </div>
      <div className="rounded-xl border border-border bg-surface-raised p-6">
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
