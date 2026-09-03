"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@bebest/ui";
import { REPORT_TYPE_DESCRIPTION, REPORT_TYPE_LABEL } from "@/data/reporting/labels";
import type { GenerateReportInput, ReportType } from "@/data/reporting/types";

const REPORT_TYPES: ReportType[] = ["weekly", "monthly", "baseline_comparison", "custom"];

interface GenerateReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: GenerateReportInput) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}

/**
 * Epic 15's "trigger a custom report" UI-surface requirement, widened to
 * cover all four report types per `lib/reporting/generate-report.ts`'s own
 * header comment: this codebase has no live scheduler yet, so `POST
 * /brands/me/reports/generate` is today's real, directly-callable trigger
 * for weekly/monthly too, not just custom. Remounted (via `key` on the
 * inner form, same pattern `CompetitorDialog` uses) every time it opens so
 * its state always starts fresh.
 */
export function GenerateReportDialog({ open, onOpenChange, onSubmit, submitError, submitting }: GenerateReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <GenerateReportForm key={open ? "open" : "closed"} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} submitError={submitError} submitting={submitting} />
      </DialogContent>
    </Dialog>
  );
}

function GenerateReportForm({
  onCancel,
  onSubmit,
  submitError,
  submitting,
}: {
  onCancel: () => void;
  onSubmit: (input: GenerateReportInput) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}) {
  const [type, setType] = useState<ReportType>("weekly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [errors, setErrors] = useState<{ periodStart?: string; periodEnd?: string }>({});

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (type !== "custom") {
      await onSubmit({ type });
      return;
    }

    const nextErrors: typeof errors = {};
    if (!periodStart) nextErrors.periodStart = "Pick a start date.";
    if (!periodEnd) nextErrors.periodEnd = "Pick an end date.";
    if (periodStart && periodEnd && new Date(periodStart) > new Date(periodEnd)) {
      nextErrors.periodEnd = "End date must be on or after the start date.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Full-day range: start at 00:00:00 of the chosen start date, end at
    // 23:59:59.999 of the chosen end date — so a single-day range (start ===
    // end) still includes that whole day's data, not zero seconds of it.
    await onSubmit({
      type,
      periodStart: new Date(`${periodStart}T00:00:00.000Z`).toISOString(),
      periodEnd: new Date(`${periodEnd}T23:59:59.999Z`).toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Generate a report</DialogTitle>
        <DialogDescription>
          A board-ready snapshot of score deltas, new opportunities, and competitor movement — frozen at the moment it&apos;s generated.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2.5">
        {REPORT_TYPES.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              type === option ? "border-accent bg-accent-muted/40" : "border-border hover:border-border-strong"
            }`}
          >
            <input
              type="radio"
              name="report-type"
              value={option}
              checked={type === option}
              onChange={() => setType(option)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-[13px] font-medium text-foreground">{REPORT_TYPE_LABEL[option]}</span>
              <span className="block text-[12px] text-muted-foreground leading-relaxed">{REPORT_TYPE_DESCRIPTION[option]}</span>
            </span>
          </label>
        ))}

        {type === "custom" && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Input
              type="date"
              label="Start date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              error={errors.periodStart}
              max={periodEnd || undefined}
            />
            <Input
              type="date"
              label="End date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              error={errors.periodEnd}
              min={periodStart || undefined}
            />
          </div>
        )}

        {submitError && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
            {submitError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          Generate report
        </Button>
      </DialogFooter>
    </form>
  );
}
