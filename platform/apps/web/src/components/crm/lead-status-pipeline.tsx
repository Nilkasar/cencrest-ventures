"use client";

import { Check, X } from "lucide-react";
import { cn } from "@bebest/ui";
import { LEAD_STATUS_SEQUENCE, type LeadStatus } from "@/data/crm/types";

const STEP_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};

/**
 * Visual pipeline for a lead's status — a vertical stack rather than a
 * horizontal stepper, so it fits the narrow sidebar card it lives in at
 * any status label length. Purely a readout: the actual mutation happens
 * through the accessible status `<Select>` next to it, so every
 * transition here has a keyboard/screen-reader-equivalent control.
 */
export function LeadStatusPipeline({ status }: { status: LeadStatus }) {
  const currentIndex = LEAD_STATUS_SEQUENCE.indexOf(status);

  return (
    <ol className="flex flex-col gap-2.5" aria-label="Lead status">
      {LEAD_STATUS_SEQUENCE.map((step, index) => {
        const done = status !== "lost" && index < currentIndex;
        const active = status !== "lost" && index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                done && "border-accent bg-accent text-accent-foreground",
                active && "border-accent text-accent bg-accent-muted",
                !done && !active && "border-border text-subtle-foreground bg-surface",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check size={11} /> : index + 1}
            </span>
            <span className={cn("text-[12.5px]", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {STEP_LABEL[step]}
            </span>
          </li>
        );
      })}
      {status === "lost" && (
        <li className="flex items-center gap-2.5 border-t border-border pt-2.5 mt-0.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-danger bg-danger-muted text-danger">
            <X size={11} />
          </span>
          <span className="text-[12.5px] font-semibold text-danger">Lost</span>
        </li>
      )}
    </ol>
  );
}
