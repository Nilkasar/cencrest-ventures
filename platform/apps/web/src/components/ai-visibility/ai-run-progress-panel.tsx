"use client";

import { Check, Loader2, Radar } from "lucide-react";
import { cn } from "@bebest/ui";
import { Section } from "@/components/patterns/section";
import { LiveChip } from "@/components/overview/primitives";
import type { AiRun } from "@/data/ai-visibility/types";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { shortProviderLabel } from "./status-badges";

/**
 * Real, step-by-step run status for a 30–60 minute job — not a spinner.
 * Two named phases because that's the real granularity `ai_runs` reports
 * (`total_jobs` / `completed_jobs` / `failed_jobs`); no invented sub-steps.
 * Evidence lands below this panel as jobs finish, so there's something to
 * read long before the run is done.
 */
export function AiRunProgressPanel({ run, subject = "your brand" }: { run: AiRun; subject?: string }) {
  const queued = run.status === "queued";
  const done = run.completedJobs + run.failedJobs;
  const pct = Math.max(0, Math.min(100, run.progressPct));

  return (
    <Section
      title={queued ? "Run queued" : `Measuring ${subject}`}
      description={
        run.startedAt
          ? `Started ${formatRelativeTime(run.startedAt)} · usually 30–60 minutes · you can leave this page and come back.`
          : "Usually 30–60 minutes once it starts · you can leave this page and come back."
      }
      icon={<Radar size={14} />}
      actions={<LiveChip label={queued ? "Queued" : "Running"} />}
    >
      <ol className="flex flex-col" aria-label="Run progress">
        <Step
          state={queued ? "active" : "done"}
          title="Queued"
          body="Waiting for a worker slot. Your monthly AI-query allowance was checked before the run was created."
          connector
        />
        <Step
          state={queued ? "todo" : "active"}
          title="Asking each model and reading the answers"
          body={`Every query goes to ${run.providers.map(shortProviderLabel).join(", ")}. Each raw answer is saved first, then read for whether you were mentioned, recommended, and how.`}
        >
          {!queued && (
            <div className="mt-3 flex max-w-md flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-muted-foreground" aria-live="polite">
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatNumber(done)}</span> of{" "}
                  <span className="font-mono tabular-nums">{formatNumber(run.totalJobs)}</span> answers in
                  {run.failedJobs > 0 && <span className="text-danger"> · {formatNumber(run.failedJobs)} failed</span>}
                </span>
                <span className="font-mono tabular-nums text-foreground">{Math.round(pct)}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
                role="progressbar"
                aria-label="Answers gathered"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out motion-reduce:transition-none"
                  style={{ transform: `scaleX(${pct / 100})` }}
                />
              </div>
            </div>
          )}
        </Step>
      </ol>
    </Section>
  );
}

function Step({
  state,
  title,
  body,
  connector = false,
  children,
}: {
  state: "done" | "active" | "todo";
  title: string;
  body: string;
  connector?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3" aria-current={state === "active" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        <StepIcon state={state} />
        {connector && <div className={cn("my-0.5 min-h-[24px] w-px flex-1", state === "done" ? "bg-accent" : "bg-border")} aria-hidden="true" />}
      </div>
      <div className={cn("min-w-0", connector && "pb-5")}>
        <p className={cn("text-[13.5px] font-medium", state === "todo" ? "text-muted-foreground" : "text-foreground")}>
          {title}
          <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : " (not started)"}</span>
        </p>
        <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
        {children}
      </div>
    </li>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "todo" }) {
  if (state === "done") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-muted text-accent" aria-hidden="true">
        <Check size={14} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-accent-foreground" aria-hidden="true">
        <Loader2 size={14} className="animate-[spin_0.9s_linear_infinite] motion-reduce:animate-none" />
      </span>
    );
  }
  return <span className="flex size-7 shrink-0 rounded-full border border-border bg-surface" aria-hidden="true" />;
}
